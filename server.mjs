// 정적 파일과, 브라우저에서 직접 부를 수 없는 주소(시세, AI)를 대신 불러 주는 로컬 서버. 외부 의존성 없음.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const home = fileURLToPath(new URL(".", import.meta.url));
const root = join(home, "public");
// startServer가 정한다. AI 요청의 출처 확인에 쓴다.
let port = 0;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

// 대신 불러 줄 수 있는 주소. 여기에 없는 호스트나 경로는 거절한다.
const proxyRoutes = [
  { host: "query1.finance.yahoo.com", path: "/v8/finance/chart/" },
  { host: "query2.finance.yahoo.com", path: "/v1/finance/search" },
];

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function proxy(target, res) {
  let url;
  try {
    url = new URL(target);
  } catch {
    url = null;
  }
  const allowed =
    url !== null &&
    url.protocol === "https:" &&
    proxyRoutes.some((route) => url.hostname === route.host && url.pathname.startsWith(route.path));
  if (!allowed) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    return;
  }
  try {
    const upstream = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (ChartDesk local)", accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: String(error?.message ?? error) });
  }
}

// ---------- AI ----------
// API 키는 이 컴퓨터의 ai-keys.json에만 두고 브라우저로 돌려보내지 않는다. 키는 해당 회사의 API 주소로만 보낸다.

// 데스크톱 앱은 앱 폴더가 읽기 전용이라 사용자 데이터 폴더를 넘겨준다.
let keyFile = join(home, "ai-keys.json");
// 주소는 시험용 서버로 바꿀 수 있다.
const ai = {
  anthropic: {
    base: process.env.CHARTDESK_ANTHROPIC_BASE ?? "https://api.anthropic.com",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    modelsPath: "/v1/models?limit=100",
    models: (body) => body.data.map((model) => model.id),
    chat: ({ model, system, messages }) => ({
      path: "/v1/messages",
      body: { model, max_tokens: 8192, system, messages, stream: true },
    }),
  },
  openai: {
    base: process.env.CHARTDESK_OPENAI_BASE ?? "https://api.openai.com",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    modelsPath: "/v1/models",
    // 대화에 쓸 수 없는 모델(임베딩, 음성, 이미지 등)은 목록에서 뺀다.
    models: (body) =>
      body.data
        .map((model) => model.id)
        .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/embedding|audio|tts|whisper|image|realtime|transcribe|moderation|instruct/.test(id))
        .sort()
        .reverse(),
    chat: ({ model, system, messages }) => ({
      path: "/v1/chat/completions",
      body: { model, messages: [{ role: "system", content: system }, ...messages], stream: true },
    }),
  },
  gemini: {
    base: process.env.CHARTDESK_GEMINI_BASE ?? "https://generativelanguage.googleapis.com",
    headers: (key) => ({ "x-goog-api-key": key }),
    modelsPath: "/v1beta/models?pageSize=200",
    models: (body) =>
      body.models
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => model.name.replace(/^models\//, ""))
        .reverse(),
    chat: ({ model, system, messages }) => ({
      path: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      },
    }),
  },
};

// 구독 계정으로 쓰기: 이 컴퓨터에 깔린 공식 CLI(Claude Code, Codex, Gemini CLI)에 본인 계정으로 로그인해 두면, 그 CLI를 불러 답을 받는다.
// 로그인과 토큰은 CLI가 맡고 ChartDesk는 보지 않는다. 사용량은 각 계정의 구독(또는 무료) 한도에서 빠진다.

const cliHome = join(tmpdir(), "chartdesk-ai");
// API 키가 환경 변수에 있으면 CLI가 계정 대신 그 키로 청구하므로 넘기지 않는다.
const cliEnv = (extra = {}) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(ANTHROPIC_(API_KEY|AUTH_TOKEN)|OPENAI_API_KEY|CODEX_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)$/.test(name)),
  ),
  ...extra,
});

/** PATH에서 명령을 찾는다. npm으로 깐 명령(.cmd)은 Node가 바로 못 돌리므로 안의 JS 파일을 node로 돌린다. 없으면 null. */
async function findCommand(name) {
  const exts = process.platform === "win32" ? [".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      if (!existsSync(file)) continue;
      if (ext !== ".cmd") return { file, prefix: [] };
      const script = /"%dp0%\\([^"]+\.js)"/.exec(await readFile(file, "utf8"))?.[1];
      if (script) return { file: "node", prefix: [join(dir, script)] };
    }
  }
  return null;
}

/** Windows의 Codex 앱에는 CLI(codex.exe)가 들어 있다. 따로 깔지 않았으면 그것을 쓴다. */
async function codexFromApp() {
  if (process.platform !== "win32") return null;
  const { out } = await runCli({ file: "powershell.exe", prefix: [] }, ["-NoProfile", "-Command", "(Get-AppxPackage -Name OpenAI.Codex).InstallLocation"], "", 15000);
  const folder = out.trim().split(/\r?\n/)[0];
  const file = folder && join(folder, "app", "resources", "codex.exe");
  return file && existsSync(file) ? { file, prefix: [] } : null;
}

/** 대화를 한 덩어리의 글로 묶는다. CLI는 질문 하나만 받기 때문이다. */
function transcript(messages) {
  if (messages.length === 1) return messages[0].content;
  const earlier = messages.slice(0, -1).map((message) => `[${message.role === "user" ? "사용자" : "AI"}]\n${message.content}`);
  return `${["[지금까지의 대화]", ...earlier].join("\n\n")}\n\n[이번 질문]\n${messages[messages.length - 1].content}`;
}

// 응답은 모두 Anthropic API의 스트림 이벤트 모양으로 바꿔 보낸다. 브라우저는 API와 똑같이 읽는다.
const textEvent = (text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });
const errorEvent = (message) => ({ type: "error", error: { message: message || "응답 오류" } });

const accounts = {
  anthropic: {
    find: () => findCommand("claude"),
    login: ["auth", "login"],
    async status(found) {
      const { out } = await runCli(found, ["auth", "status", "--json"], "", 15000);
      try {
        const body = JSON.parse(out);
        return { loggedIn: body.loggedIn === true, plan: body.subscriptionType ?? body.authMethod ?? "" };
      } catch {
        return { loggedIn: false };
      }
    },
    models: async () => ["opus", "sonnet", "haiku"],
    // 도구는 모두 끄고, 설정·MCP·CLAUDE.md를 읽지 않도록 빈 폴더에서 돌린다.
    run: ({ model, systemFile, messages }) => ({
      args: [
        "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config",
        "--system-prompt-file", systemFile, "--model", model,
      ],
      input: transcript(messages),
    }),
    events(line) {
      if (line.type === "stream_event") return [line.event];
      if (line.type === "result" && line.is_error) return [errorEvent(line.result || line.subtype)];
      return [];
    },
  },
  openai: {
    find: async () => (await findCommand("codex")) ?? codexFromApp(),
    login: ["login"],
    async status(found) {
      const { code, out } = await runCli(found, ["login", "status"], "", 15000);
      const loggedIn = code === 0 && /logged in/i.test(out);
      return { loggedIn, plan: loggedIn ? (/chatgpt/i.test(out) ? "ChatGPT" : "API 키") : "" };
    },
    // Codex가 받아 둔 모델 목록에서 고른다. 없으면 Codex의 기본 모델을 쓴다.
    async models() {
      try {
        const cache = JSON.parse(await readFile(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "models_cache.json"), "utf8"));
        const listed = cache.models.filter((model) => model.visibility === "list").sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
        return ["default", ...listed.map((model) => model.slug)];
      } catch {
        return ["default"];
      }
    },
    // Codex는 코드 작업용이라 지시문을 바꿀 수 없다. 지시문은 질문 앞에 붙이고, 빈 폴더에서 읽기 전용으로 돌린다.
    run: ({ model, system, messages }) => ({
      args: [
        "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s", "read-only",
        ...(model === "default" ? [] : ["-m", model]), "-",
      ],
      input: `[지켜야 할 지시]\n${system}\n\n${transcript(messages)}`,
    }),
    events(line, state) {
      if (line.type === "item.completed" && line.item?.type === "agent_message" && line.item.text) {
        const text = state.wrote ? `\n\n${line.item.text}` : line.item.text;
        state.wrote = true;
        return [textEvent(text)];
      }
      if (line.type === "turn.failed") return [errorEvent(line.error?.message)];
      if (line.type === "error") return [errorEvent(line.message)];
      return [];
    },
  },
  gemini: {
    find: () => findCommand("gemini"),
    // Gemini CLI는 처음 실행할 때 로그인 방법을 묻는다. "Sign in with Google"을 고른다.
    login: [],
    async status() {
      const loggedIn = existsSync(join(homedir(), ".gemini", "oauth_creds.json"));
      return { loggedIn, plan: loggedIn ? "Google 계정" : "" };
    },
    models: async () => ["auto", "pro", "flash", "flash-lite"],
    // 지시문은 GEMINI_SYSTEM_MD로 바꾼다. 확장 기능은 끈다.
    // 신뢰하지 않은 폴더에서는 실행을 거부하므로, 돌리는 곳(ChartDesk의 빈 임시 폴더)을 신뢰한다고 알린다.
    run: ({ model, systemFile, messages }) => ({
      args: ["-p", "", "-o", "stream-json", "-e", "none", ...(model === "auto" ? [] : ["-m", model])],
      env: { GEMINI_SYSTEM_MD: systemFile, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      input: transcript(messages),
    }),
    // Google은 무료 개인 계정(Gemini Code Assist for individuals)의 Gemini CLI 사용을 끝냈다. 이때는 키로 쓰라고 알린다.
    explain: (failure) =>
      /IneligibleTierError|no longer supported/i.test(failure)
        ? "Google이 이 계정 종류(무료 개인 계정)의 Gemini CLI 사용을 중단했습니다. Gemini는 API 키(aistudio.google.com, 무료 한도 있음)로 연결하세요."
        : null,
    events(line) {
      if (line.type === "message" && line.role === "assistant") {
        const text = typeof line.content === "string" ? line.content : (line.content ?? []).map((part) => part.text ?? "").join("");
        return text ? [textEvent(text)] : [];
      }
      if (line.type === "error" || (line.type === "result" && line.status === "error")) return [errorEvent(line.error?.message ?? line.message)];
      return [];
    },
  },
};

// 찾은 명령은 기억해 두되, 상태를 볼 때마다 다시 찾는다(그 사이에 설치했을 수 있다).
const commands = new Map();
async function command(id) {
  if (!commands.has(id)) commands.set(id, await accounts[id].find());
  return commands.get(id);
}

async function accountStatus(id) {
  commands.delete(id);
  const found = await command(id);
  if (!found) return { installed: false, loggedIn: false };
  return { installed: true, ...(await accounts[id].status(found)) };
}

/** 명령을 실행해 끝날 때까지 기다린다. 실행하지 못하면 code가 null이다. */
function runCli(found, args, input, timeout) {
  return new Promise((done) => {
    let out = "";
    let child;
    try {
      child = spawn(found.file, [...found.prefix, ...args], { cwd: tmpdir(), env: cliEnv(), windowsHide: true, timeout });
    } catch {
      done({ code: null, out });
      return;
    }
    child.on("error", () => done({ code: null, out }));
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => done({ code: code ?? -1, out }));
    child.stdin.end(input);
  });
}

async function chatWithAccount(id, body, res) {
  const account = accounts[id];
  const found = await command(id);
  if (!found) {
    sendJson(res, 502, { error: "이 서비스의 CLI를 찾지 못했습니다. 계정 연결에서 설치 안내를 보세요" });
    return;
  }
  await mkdir(cliHome, { recursive: true });
  const systemFile = join(cliHome, `system-${process.pid}-${Date.now()}.md`);
  await writeFile(systemFile, body.system);
  const run = account.run({ ...body, systemFile });
  const child = spawn(found.file, [...found.prefix, ...run.args], { cwd: cliHome, env: cliEnv(run.env), windowsHide: true });
  const state = {};
  let started = false;
  let failure = "";
  res.on("close", () => child.kill());
  child.stderr.on("data", (chunk) => (failure += chunk));
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const rows = buffer.split("\n");
    buffer = rows.pop();
    for (const row of rows) {
      let events = [];
      try {
        events = account.events(JSON.parse(row), state);
      } catch {
        // JSON이 아닌 줄(안내 문구 등)은 건너뛴다.
      }
      for (const event of events) {
        if (!started) res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
        started = true;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
  });
  const code = await new Promise((done) => {
    child.on("error", () => done(null));
    child.on("close", done);
    child.stdin.end(run.input);
  });
  await rm(systemFile, { force: true });
  if (started) res.end();
  else sendJson(res, 502, { error: account.explain?.(failure) ?? (failure.trim().slice(-400) || `CLI가 답 없이 끝났습니다 (코드 ${code})`) });
}

/** 로그인은 CLI가 브라우저를 열어 처리한다. 입력이 필요할 수 있어 새 터미널 창에서 띄운다. */
async function openLogin(id) {
  const found = await command(id);
  if (!found) return false;
  const quote = (part) => (/[\s"]/.test(part) ? `"${part}"` : part);
  const line = [found.file, ...found.prefix, ...accounts[id].login].map(quote).join(" ");
  if (process.platform === "win32") {
    // cmd /k는 맨 앞뒤 따옴표를 떼므로 한 번 더 감싼다.
    spawn("cmd.exe", ["/c", "start", '""', "cmd", "/k", `"${line}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(line)}`], { detached: true, stdio: "ignore" }).unref();
  } else return false;
  return true;
}

async function readKeys() {
  try {
    const keys = JSON.parse(await readFile(keyFile, "utf8"));
    return keys && typeof keys === "object" ? keys : {};
  } catch {
    return {};
  }
}

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("요청이 너무 큽니다");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** 회사마다 다른 오류 본문에서 사람이 읽을 문장을 꺼낸다. */
async function upstreamError(upstream) {
  const text = await upstream.text();
  try {
    const body = JSON.parse(text);
    const error = Array.isArray(body) ? body[0]?.error : body.error;
    return (typeof error === "string" ? error : error?.message) ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || upstream.statusText;
  }
}

async function handleAi(req, res, url) {
  // 다른 사이트의 페이지가 이 서버를 부르지 못하게 한다.
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    sendJson(res, 403, { error: "허용되지 않은 출처입니다" });
    return;
  }
  const keys = await readKeys();
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/ai/status") {
    // CLI 상태 확인은 몇 초 걸릴 수 있어 한꺼번에 돌린다.
    const ids = Object.keys(ai);
    const found = await Promise.all(ids.map((id) => (Object.hasOwn(accounts, id) ? accountStatus(id) : null)));
    const status = {};
    ids.forEach((id, i) => {
      const key = typeof keys[id] === "string" ? keys[id] : "";
      status[id] = { connected: key.length > 0, hint: key ? `…${key.slice(-4)}` : "", account: found[i] };
    });
    sendJson(res, 200, status);
    return;
  }

  if (route === "POST /api/ai/login") {
    const { provider: id } = await readBody(req);
    if (!Object.hasOwn(accounts, id)) {
      sendJson(res, 400, { error: "계정으로 로그인할 수 없는 서비스입니다" });
      return;
    }
    if (!(await openLogin(id))) {
      sendJson(res, 400, { error: "로그인 창을 열지 못했습니다. 터미널에서 CLI를 직접 실행해 로그인하세요" });
      return;
    }
    sendJson(res, 200, { opened: true });
    return;
  }

  if (route === "POST /api/ai/key") {
    const { provider, key } = await readBody(req);
    if (!ai[provider] || typeof key !== "string") {
      sendJson(res, 400, { error: "잘못된 요청입니다" });
      return;
    }
    if (key.trim()) keys[provider] = key.trim();
    else delete keys[provider];
    await writeFile(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
    sendJson(res, 200, { connected: Boolean(keys[provider]) });
    return;
  }

  const provider = ai[route === "GET /api/ai/models" ? url.searchParams.get("provider") : undefined];
  if (route === "GET /api/ai/models" && url.searchParams.get("via") === "account") {
    const id = url.searchParams.get("provider");
    if (!Object.hasOwn(accounts, id)) sendJson(res, 400, { error: "계정으로 로그인할 수 없는 서비스입니다" });
    else sendJson(res, 200, { models: await accounts[id].models() });
    return;
  }
  if (route === "GET /api/ai/models") {
    const key = keys[url.searchParams.get("provider")];
    if (!provider || !key) {
      sendJson(res, 400, { error: "먼저 API 키를 연결하세요" });
      return;
    }
    const upstream = await fetch(provider.base + provider.modelsPath, { headers: provider.headers(key), signal: AbortSignal.timeout(20000) });
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: await upstreamError(upstream) });
      return;
    }
    sendJson(res, 200, { models: provider.models(await upstream.json()) });
    return;
  }

  if (route === "POST /api/ai/chat") {
    const body = await readBody(req);
    const target = ai[body.provider];
    const key = keys[body.provider];
    const valid =
      target &&
      typeof body.model === "string" &&
      body.model.length > 0 &&
      typeof body.system === "string" &&
      Array.isArray(body.messages) &&
      body.messages.every((message) => ["user", "assistant"].includes(message?.role) && typeof message.content === "string");
    if (!valid) {
      sendJson(res, 400, { error: "잘못된 요청입니다" });
      return;
    }
    if (body.via === "account") {
      const id = body.provider;
      if (!Object.hasOwn(accounts, id) || !(await accounts[id].models()).includes(body.model) || body.messages.length === 0) sendJson(res, 400, { error: "잘못된 요청입니다" });
      else await chatWithAccount(id, body, res);
      return;
    }
    if (!key) {
      sendJson(res, 400, { error: "먼저 API 키를 연결하세요" });
      return;
    }
    const request = target.chat(body);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const upstream = await fetch(target.base + request.path, {
      method: "POST",
      headers: { ...target.headers(key), "content-type": "application/json" },
      body: JSON.stringify(request.body),
      signal: abort.signal,
    });
    if (!upstream.ok || !upstream.body) {
      sendJson(res, upstream.ok ? 502 : upstream.status, { error: await upstreamError(upstream) });
      return;
    }
    // 응답은 오는 대로 그대로 흘려보낸다. 해석은 브라우저가 한다.
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
    return;
  }

  sendJson(res, 404, { error: "없는 주소입니다" });
}

// ---------- 장외 시간 거래량 (선택) ----------
// Yahoo는 장전·장후 봉의 거래량을 주지 않는다. local/tv-feed.mjs가 있으면 그 구간의 거래량을 받아 채운다.
// 공식 API가 아니어서 저장소에는 넣지 않았다. 없으면 장외 봉은 거래량 없이 그린다.
const extendedFeed = await import("./local/tv-feed.mjs").catch((error) => {
  if (error?.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  if (requestUrl.pathname === "/api/tv/bars") {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (extendedFeed) await extendedFeed.handleExtendedBars(res, requestUrl);
    else sendJson(res, 404, { error: "장외 거래량 모듈이 없습니다" });
    return;
  }
  if (requestUrl.pathname === "/api/proxy") {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    await proxy(requestUrl.searchParams.get("url") ?? "", res);
    return;
  }
  if (requestUrl.pathname.startsWith("/api/ai/")) {
    try {
      await handleAi(req, res, requestUrl);
    } catch (error) {
      if (res.headersSent) res.end();
      else sendJson(res, 502, { error: String(error?.message ?? error) });
    }
    return;
  }
  const pathname = decodeURIComponent(requestUrl.pathname);
  const file = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

/** 서버를 띄운다. 127.0.0.1에서만 듣는다. */
export function startServer(options = {}) {
  port = options.port ?? 5173;
  keyFile = options.keyFile ?? keyFile;
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      done({ port, url: `http://127.0.0.1:${port}/` });
    });
  });
}

// node server.mjs로 직접 실행했을 때.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({
    port: Number(process.env.PORT ?? 5173),
    keyFile: process.env.CHARTDESK_KEY_FILE,
  });
  console.log(`ChartDesk: ${url}`);
}
