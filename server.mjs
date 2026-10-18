// 정적 파일과, 브라우저에서 직접 부를 수 없는 주소(시세, AI)를 대신 불러 주는 로컬 서버. 외부 의존성 없음.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  // 오른쪽 패널의 관련 뉴스(한국어 기사)
  { host: "news.google.com", path: "/rss/search" },
];

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

// 대신 불러 온 응답을 잠깐 기억한다. 같은 주소를 여러 번 부르면 한 번만 받아 차단될 위험을 줄인다.
// 시세(차트)는 실시간에 가까워야 하므로 동시에 몰린 요청만 합치는 정도(3초)로 둔다.
const proxyCache = new Map();
const proxyPending = new Map();
const PROXY_CACHE_LIMIT = 300;

function cacheTtl(url) {
  if (url.hostname === "news.google.com") return 5 * 60_000;
  if (url.pathname.startsWith("/v1/finance/search")) return 60_000;
  return 3_000;
}

async function cachedFetch(url) {
  const key = url.href;
  const hit = proxyCache.get(key);
  if (hit && Date.now() - hit.at < cacheTtl(url)) return hit;
  if (proxyPending.has(key)) return proxyPending.get(key);
  const request = (async () => {
    const upstream = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (ChartDesk local)", accept: "application/json, application/rss+xml;q=0.9, */*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    const result = {
      at: Date.now(),
      status: upstream.status,
      // 받은 형식을 그대로 알려 준다(Yahoo는 JSON, Google 뉴스는 RSS).
      type: upstream.headers.get("content-type") ?? "application/octet-stream",
      body: Buffer.from(await upstream.arrayBuffer()),
    };
    if (upstream.ok) {
      proxyCache.delete(key);
      proxyCache.set(key, result);
      // 오래된 것부터 지운다(Map은 넣은 순서를 지킨다).
      while (proxyCache.size > PROXY_CACHE_LIMIT) proxyCache.delete(proxyCache.keys().next().value);
    }
    return result;
  })();
  proxyPending.set(key, request);
  try {
    return await request;
  } finally {
    proxyPending.delete(key);
  }
}

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
    const result = await cachedFetch(url);
    res.writeHead(result.status, { "content-type": result.type, "cache-control": "no-store" });
    res.end(result.body);
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
    // 별칭(opus·sonnet·haiku)은 늘 최신 버전을 가리킨다. 버전을 고정하려면 아래 ID를 고른다.
    // Fable은 구독 한도가 아니라 사용 크레딧이 있어야 쓸 수 있다.
    models: async () => [
      "opus", "sonnet", "haiku",
      "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
      "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6",
      "claude-haiku-5-5", "claude-haiku-4-5",
      "claude-fable-5-1", "claude-fable-5",
    ],
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
    // 디스코드는 오류를 error가 아니라 message에 담는다.
    return (typeof error === "string" ? error : error?.message) ?? (typeof body.message === "string" ? body.message : null) ?? text.slice(0, 300);
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

// ---------- 메시지 알림 (텔레그램, 디스코드) ----------
// 가격·조건 알림이 울리면 화면이 /api/notify/send로 보내고, 서버가 사용자의 텔레그램 봇이나 디스코드 웹후크로 전달한다.
// 봇 토큰과 웹후크 주소는 AI 키와 같은 파일(ai-keys.json의 notify)에만 두고 화면으로 돌려보내지 않는다.
// 주소는 시험용 서버로 바꿀 수 있다.
const TELEGRAM_BASE = process.env.CHARTDESK_TELEGRAM_BASE ?? "https://api.telegram.org";
const DISCORD_BASES = process.env.CHARTDESK_DISCORD_BASE ? [process.env.CHARTDESK_DISCORD_BASE] : ["https://discord.com", "https://discordapp.com"];
const TELEGRAM_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
// 알림이 한꺼번에 쏟아져도 메시지 서비스에서 막히지 않게 1분에 보낼 수 있는 수를 제한한다.
const NOTIFY_PER_MINUTE = 20;
let notifySent = [];

const notifyOf = (keys) => (keys.notify && typeof keys.notify === "object" ? keys.notify : {});
const hint = (text) => (text ? `…${text.slice(-4)}` : "");
const validWebhook = (url) => typeof url === "string" && DISCORD_BASES.some((base) => url.startsWith(`${base}/api/webhooks/`));

function notifyStatus(notify) {
  const telegram = notify.telegram ?? {};
  return {
    telegram: { connected: Boolean(telegram.token && telegram.chatId), token: Boolean(telegram.token), hint: hint(telegram.token), chatId: telegram.chatId ?? "", chatName: telegram.chatName ?? "" },
    discord: { connected: Boolean(notify.discord?.webhook), hint: hint(notify.discord?.webhook) },
  };
}

/** 메시지 서비스 하나에 보낸다. 실패하면 사람이 읽을 이유를 던진다. */
async function deliver(channel, notify, text) {
  if (channel === "telegram") {
    const { token, chatId } = notify.telegram;
    const upstream = await fetch(`${TELEGRAM_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok || body.ok === false) throw new Error(body.description ?? `HTTP ${upstream.status}`);
    return;
  }
  const upstream = await fetch(notify.discord.webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text, username: "ChartDesk", allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) throw new Error(await upstreamError(upstream));
}

/** 설정된 곳마다 보내고 결과를 { telegram: 'ok' | 'off' | 오류 문장, discord: … }로 돌려준다. */
async function broadcast(notify, title, body) {
  const text = `${title ? `${title}\n` : ""}${body}`.slice(0, 1500);
  const status = notifyStatus(notify);
  const result = {};
  await Promise.all(["telegram", "discord"].map(async (channel) => {
    if (!status[channel].connected) {
      result[channel] = "off";
      return;
    }
    try {
      await deliver(channel, notify, text);
      result[channel] = "ok";
    } catch (error) {
      result[channel] = String(error?.message ?? error);
    }
  }));
  return result;
}

async function handleNotify(req, res, url) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    sendJson(res, 403, { error: "허용되지 않은 출처입니다" });
    return;
  }
  const keys = await readKeys();
  const notify = notifyOf(keys);
  const route = `${req.method} ${url.pathname}`;
  const save = async () => {
    keys.notify = notify;
    await writeFile(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  };

  if (route === "GET /api/notify/status") {
    sendJson(res, 200, notifyStatus(notify));
    return;
  }

  // 빈 문자열은 지우기, 보내지 않은 칸은 그대로 둔다.
  if (route === "POST /api/notify/config") {
    const body = await readBody(req, 10_000);
    if (body.telegram && typeof body.telegram === "object") {
      const { token, chatId } = body.telegram;
      notify.telegram ??= {};
      if (typeof token === "string") {
        const value = token.trim();
        if (value && !TELEGRAM_TOKEN.test(value)) {
          sendJson(res, 400, { error: "텔레그램 봇 토큰 모양이 아닙니다 (예: 123456789:AA…)" });
          return;
        }
        // 다른 봇으로 바꾸면 그 봇이 찾은 대화 이름은 맞지 않는다.
        if (value !== notify.telegram.token) delete notify.telegram.chatName;
        if (value) notify.telegram.token = value;
        else delete notify.telegram.token;
      }
      if (typeof chatId === "string" || typeof chatId === "number") {
        const id = String(chatId).trim();
        if (id && !/^-?\d+$|^@\w{4,}$/.test(id)) {
          sendJson(res, 400, { error: "채팅 ID는 숫자(또는 @채널이름)입니다" });
          return;
        }
        if (id !== notify.telegram.chatId) delete notify.telegram.chatName;
        if (id) notify.telegram.chatId = id;
        else delete notify.telegram.chatId;
      }
      if (!notify.telegram.token && !notify.telegram.chatId) delete notify.telegram;
    }
    if (body.discord && typeof body.discord === "object" && typeof body.discord.webhook === "string") {
      const webhook = body.discord.webhook.trim();
      if (webhook && !validWebhook(webhook)) {
        sendJson(res, 400, { error: "디스코드 웹후크 주소가 아닙니다 (https://discord.com/api/webhooks/…)" });
        return;
      }
      if (webhook) notify.discord = { webhook };
      else delete notify.discord;
    }
    await save();
    sendJson(res, 200, notifyStatus(notify));
    return;
  }

  // 텔레그램에서 봇에게 아무 메시지나 보낸 뒤 부르면, 가장 최근에 말을 건 대화를 채팅 ID로 저장한다.
  if (route === "POST /api/notify/telegram/find-chat") {
    const token = notify.telegram?.token;
    if (!token) {
      sendJson(res, 400, { error: "먼저 봇 토큰을 저장하세요" });
      return;
    }
    const upstream = await fetch(`${TELEGRAM_BASE}/bot${token}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10_000) });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok || body.ok === false) {
      sendJson(res, 502, { error: body.description ?? `HTTP ${upstream.status}` });
      return;
    }
    const chats = (body.result ?? []).map((update) => (update.message ?? update.channel_post ?? update.my_chat_member)?.chat).filter(Boolean);
    const chat = chats[chats.length - 1];
    if (!chat) {
      sendJson(res, 404, { error: "봇이 받은 메시지가 없습니다. 텔레그램에서 봇에게 아무 메시지나 보낸 뒤 다시 누르세요" });
      return;
    }
    notify.telegram.chatId = String(chat.id);
    notify.telegram.chatName = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "");
    await save();
    sendJson(res, 200, notifyStatus(notify));
    return;
  }

  if (route === "POST /api/notify/send" || route === "POST /api/notify/test") {
    const test = route.endsWith("/test");
    const body = test ? {} : await readBody(req, 20_000);
    const message = test ? "ChartDesk 알림이 여기로 옵니다." : typeof body.body === "string" ? body.body.trim() : "";
    if (!message) {
      sendJson(res, 400, { error: "보낼 내용이 없습니다" });
      return;
    }
    const now = Date.now();
    notifySent = notifySent.filter((time) => now - time < 60_000);
    if (notifySent.length >= NOTIFY_PER_MINUTE) {
      sendJson(res, 429, { error: "1분에 보낼 수 있는 알림 수를 넘었습니다" });
      return;
    }
    notifySent.push(now);
    const title = test ? "ChartDesk 테스트" : typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 100) : "ChartDesk 알림";
    sendJson(res, 200, await broadcast(notify, title, message));
    return;
  }

  sendJson(res, 404, { error: "없는 주소입니다" });
}

// ---------- 접근 확인 ----------
// 1) 주소(Host)가 이 서버(127.0.0.1·localhost의 이 포트)가 아니면 거절한다. 다른 사이트가 자기 도메인을 127.0.0.1로
//    돌려 이 서버를 부르는 방법(DNS 리바인딩)을 막는다.
// 2) /api/는 첫 페이지를 받을 때 심어 둔 쿠키가 있어야 받는다. 쿠키는 서버를 켤 때마다 새로 만든다.
//    같은 컴퓨터의 다른 프로그램이나 웹페이지가 키 상태를 보거나 대리 호출을 쓰지 못하게 한다(안드로이드 앱과 같은 방식).
const TOKEN_COOKIE = "chartdesk_token";
const token = randomBytes(24).toString("base64url");

const allowedHost = (host) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

function hasToken(req) {
  return (req.headers.cookie ?? "").split(";").some((part) => part.trim() === `${TOKEN_COOKIE}=${token}`);
}

const server = createServer(async (req, res) => {
  if (!allowedHost(req.headers.host)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    return;
  }
  const requestUrl = new URL(req.url, "http://localhost");
  if (requestUrl.pathname.startsWith("/api/") && !hasToken(req)) {
    sendJson(res, 403, { error: "페이지를 새로 고친 뒤 다시 시도하세요" });
    return;
  }
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
  if (requestUrl.pathname.startsWith("/api/notify/")) {
    try {
      await handleNotify(req, res, requestUrl);
    } catch (error) {
      if (res.headersSent) res.end();
      else sendJson(res, 502, { error: String(error?.message ?? error) });
    }
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
    const headers = {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    };
    // 화면을 받을 때 /api/용 쿠키를 심는다. 화면의 스크립트는 읽을 수 없게(HttpOnly) 하고, 이 사이트 안에서만 보낸다.
    if (file === join(root, "index.html")) headers["set-cookie"] = `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
    res.writeHead(200, headers);
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
