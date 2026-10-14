// 정적 파일과, 브라우저에서 직접 부를 수 없는 주소(시세, AI)를 대신 불러 주는 로컬 서버. 외부 의존성 없음.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const home = fileURLToPath(new URL(".", import.meta.url));
const root = join(home, "public");
const port = Number(process.env.PORT ?? 5173);
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

const keyFile = process.env.CHARTDESK_KEY_FILE ?? join(home, "ai-keys.json");
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
    const status = {};
    for (const id of Object.keys(ai)) {
      const key = typeof keys[id] === "string" ? keys[id] : "";
      status[id] = { connected: key.length > 0, hint: key ? `…${key.slice(-4)}` : "" };
    }
    sendJson(res, 200, status);
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

createServer(async (req, res) => {
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
}).listen(port, "127.0.0.1", () => {
  console.log(`ChartDesk: http://127.0.0.1:${port}/`);
});
