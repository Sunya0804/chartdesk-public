package com.sunya0804.chartdesk;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * 데스크톱 앱의 server.mjs를 옮긴 것. 화면(public 폴더)을 내주고, 웹뷰에서 직접 부를 수 없는 주소(시세, AI)를 대신 부른다.
 * 127.0.0.1에서만 듣고, /api/ 요청은 앱이 웹뷰에 넣어 둔 쿠키(token)가 있어야 받는다. 같은 휴대폰의 다른 앱이 키를 쓰지 못하게 하려는 것이다.
 */
final class LocalServer {
    // 웹뷰의 저장소(localStorage)는 주소의 포트마다 따로라서 포트를 고정한다. 다른 앱이 쓰고 있으면 다음 번호를 쓴다.
    private static final int[] PORTS = { 47380, 47381, 47382, 47383 };
    static final String COOKIE = "chartdesk_token";

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "text/javascript; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("json", "application/json; charset=utf-8");
        TYPES.put("png", "image/png");
    }

    // 대신 불러 줄 수 있는 주소. 여기에 없는 호스트나 경로는 거절한다.
    private static final String[][] PROXY_ROUTES = {
        { "query1.finance.yahoo.com", "/v8/finance/chart/" },
        { "query2.finance.yahoo.com", "/v1/finance/search" },
    };

    private final AssetManager assets;
    private final SharedPreferences keys;
    private final String token;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket socket;
    private int port;

    LocalServer(Context context, String token) {
        this.assets = context.getAssets();
        this.keys = context.getSharedPreferences("ai-keys", Context.MODE_PRIVATE);
        this.token = token;
    }

    int start() throws IOException {
        IOException last = null;
        for (int candidate : PORTS) {
            try {
                socket = new ServerSocket(candidate, 50, InetAddress.getByName("127.0.0.1"));
                port = candidate;
                break;
            } catch (IOException error) {
                last = error;
            }
        }
        if (socket == null) throw last;
        Thread accept = new Thread(() -> {
            while (!socket.isClosed()) {
                try {
                    Socket client = socket.accept();
                    pool.execute(() -> serve(client));
                } catch (IOException ignored) {
                    // 닫힐 때 여기로 온다.
                }
            }
        }, "chartdesk-server");
        accept.setDaemon(true);
        accept.start();
        return port;
    }

    void stop() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    // ---------- HTTP ----------

    private static final class Request {
        String method;
        String path;
        final Map<String, String> query = new HashMap<>();
        final Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];

        JSONObject json() throws JSONException {
            return new JSONObject(new String(body, StandardCharsets.UTF_8));
        }
    }

    /** 사람이 읽을 오류가 담긴 응답. */
    private static final class Failure extends Exception {
        final int status;

        Failure(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private void serve(Socket client) {
        try (Socket ignored = client; InputStream in = client.getInputStream(); OutputStream out = client.getOutputStream()) {
            client.setSoTimeout(30000);
            Request request = read(in);
            if (request == null) return;
            client.setSoTimeout(0);
            try {
                route(request, out);
            } catch (Failure failure) {
                sendJson(out, failure.status, error(failure.getMessage()));
            } catch (JSONException error) {
                sendJson(out, 400, error("잘못된 요청입니다"));
            } catch (IOException error) {
                sendJson(out, 502, error(String.valueOf(error.getMessage())));
            }
        } catch (IOException ignored) {
            // 웹뷰가 연결을 끊었다.
        }
    }

    private static Request read(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0;
        while (matched < 4) {
            int b = in.read();
            if (b < 0) return null;
            head.write(b);
            matched = (b == (matched % 2 == 0 ? '\r' : '\n')) ? matched + 1 : (b == '\r' ? 1 : 0);
            if (head.size() > 65536) return null;
        }
        String[] lines = head.toString("ISO-8859-1").split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        Request request = new Request();
        request.method = first[0];
        String target = first[1];
        int mark = target.indexOf('?');
        request.path = URLDecoder.decode(mark < 0 ? target : target.substring(0, mark), "UTF-8");
        if (mark >= 0) {
            for (String pair : target.substring(mark + 1).split("&")) {
                if (pair.isEmpty()) continue;
                int equals = pair.indexOf('=');
                String name = URLDecoder.decode(equals < 0 ? pair : pair.substring(0, equals), "UTF-8");
                request.query.put(name, equals < 0 ? "" : URLDecoder.decode(pair.substring(equals + 1), "UTF-8"));
            }
        }
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) request.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        int length = 0;
        try {
            length = Integer.parseInt(request.headers.getOrDefault("content-length", "0"));
        } catch (NumberFormatException ignored) {
        }
        if (length < 0 || length > 2_000_000) return null;
        request.body = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(request.body, read, length - read);
            if (n < 0) return null;
            read += n;
        }
        return request;
    }

    private static void writeHead(OutputStream out, int status, String type, long length) throws IOException {
        StringBuilder head = new StringBuilder("HTTP/1.1 ").append(status).append(status < 400 ? " OK" : " Error").append("\r\n")
            .append("Content-Type: ").append(type).append("\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n");
        if (length >= 0) head.append("Content-Length: ").append(length).append("\r\n");
        out.write(head.append("\r\n").toString().getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void send(OutputStream out, int status, String type, byte[] body) throws IOException {
        writeHead(out, status, type, body.length);
        out.write(body);
        out.flush();
    }

    private static void sendJson(OutputStream out, int status, Object body) throws IOException {
        send(out, status, TYPES.get("json"), body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static JSONObject error(String message) {
        try {
            return new JSONObject().put("error", message);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    // ---------- 길 찾기 ----------

    private void route(Request request, OutputStream out) throws IOException, JSONException, Failure {
        if (!request.path.startsWith("/api/")) {
            serveFile(request, out);
            return;
        }
        if (!authorized(request)) throw new Failure(403, "허용되지 않은 요청입니다");
        if (request.path.equals("/api/proxy") && request.method.equals("GET")) {
            proxy(request.query.getOrDefault("url", ""), out);
            return;
        }
        if (request.path.equals("/api/tv/bars")) throw new Failure(404, "장외 거래량 모듈이 없습니다");
        if (request.path.startsWith("/api/ai/")) {
            ai(request, out);
            return;
        }
        throw new Failure(404, "없는 주소입니다");
    }

    /** 앱이 웹뷰에 넣어 둔 쿠키가 있고, 다른 사이트에서 부른 것이 아닌지 본다. */
    private boolean authorized(Request request) {
        String origin = request.headers.get("origin");
        if (origin != null && !origin.equals("http://127.0.0.1:" + port)) return false;
        for (String part : request.headers.getOrDefault("cookie", "").split(";")) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && pair[0].equals(COOKIE) && pair[1].equals(token)) return true;
        }
        return false;
    }

    private void serveFile(Request request, OutputStream out) throws IOException {
        String path = request.path.equals("/") ? "index.html" : request.path.substring(1);
        if (path.contains("..") || path.startsWith("/")) {
            send(out, 403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8));
            return;
        }
        byte[] body;
        try (InputStream in = assets.open(path)) {
            body = readAll(in);
        } catch (IOException missing) {
            send(out, 404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        // 화면 스크립트보다 먼저 앱 기능(버전, 업데이트, 파일 저장, 알림)을 붙인다.
        if (path.equals("index.html")) {
            String html = new String(body, StandardCharsets.UTF_8).replace("</head>", "\t<script src=\"android-bridge.js\"></script>\n</head>");
            body = html.getBytes(StandardCharsets.UTF_8);
        }
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        send(out, 200, TYPES.getOrDefault(extension, "application/octet-stream"), body);
    }

    private static void proxy(String target, OutputStream out) throws IOException, Failure {
        URL url;
        try {
            url = new URL(target);
        } catch (IOException bad) {
            throw new Failure(403, "Forbidden");
        }
        boolean allowed = false;
        for (String[] route : PROXY_ROUTES) {
            allowed |= url.getProtocol().equals("https") && url.getHost().equals(route[0]) && url.getPath().startsWith(route[1]);
        }
        if (!allowed) throw new Failure(403, "Forbidden");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (ChartDesk Android)");
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            send(out, status, TYPES.get("json"), readAll(bodyOf(connection)));
        } finally {
            connection.disconnect();
        }
    }

    // ---------- AI ----------
    // API 키는 이 앱의 저장소에만 두고 화면으로 돌려보내지 않는다. 키는 해당 회사의 API 주소로만 보낸다.

    private interface Provider {
        String base();
        Map<String, String> headers(String key);
        String modelsPath();
        List<String> models(JSONObject body) throws JSONException;
        String chatPath(String model);
        JSONObject chatBody(String model, String system, JSONArray messages) throws JSONException;
    }

    private static final Pattern OPENAI_CHAT = Pattern.compile("^(gpt|o\\d|chatgpt).*");
    private static final Pattern OPENAI_OTHER = Pattern.compile(".*(embedding|audio|tts|whisper|image|realtime|transcribe|moderation|instruct).*");

    private static final Map<String, Provider> PROVIDERS = new HashMap<>();
    static {
        PROVIDERS.put("anthropic", new Provider() {
            public String base() { return "https://api.anthropic.com"; }
            public Map<String, String> headers(String key) {
                Map<String, String> headers = new HashMap<>();
                headers.put("x-api-key", key);
                headers.put("anthropic-version", "2023-06-01");
                return headers;
            }
            public String modelsPath() { return "/v1/models?limit=100"; }
            public List<String> models(JSONObject body) throws JSONException {
                List<String> ids = new ArrayList<>();
                JSONArray data = body.getJSONArray("data");
                for (int i = 0; i < data.length(); i++) ids.add(data.getJSONObject(i).getString("id"));
                return ids;
            }
            public String chatPath(String model) { return "/v1/messages"; }
            public JSONObject chatBody(String model, String system, JSONArray messages) throws JSONException {
                return new JSONObject().put("model", model).put("max_tokens", 8192).put("system", system).put("messages", messages).put("stream", true);
            }
        });
        PROVIDERS.put("openai", new Provider() {
            public String base() { return "https://api.openai.com"; }
            public Map<String, String> headers(String key) { return Collections.singletonMap("authorization", "Bearer " + key); }
            public String modelsPath() { return "/v1/models"; }
            // 대화에 쓸 수 없는 모델(임베딩, 음성, 이미지 등)은 목록에서 뺀다.
            public List<String> models(JSONObject body) throws JSONException {
                List<String> ids = new ArrayList<>();
                JSONArray data = body.getJSONArray("data");
                for (int i = 0; i < data.length(); i++) {
                    String id = data.getJSONObject(i).getString("id");
                    if (OPENAI_CHAT.matcher(id).matches() && !OPENAI_OTHER.matcher(id).matches()) ids.add(id);
                }
                Collections.sort(ids, Collections.reverseOrder());
                return ids;
            }
            public String chatPath(String model) { return "/v1/chat/completions"; }
            public JSONObject chatBody(String model, String system, JSONArray messages) throws JSONException {
                JSONArray all = new JSONArray().put(new JSONObject().put("role", "system").put("content", system));
                for (int i = 0; i < messages.length(); i++) all.put(messages.get(i));
                return new JSONObject().put("model", model).put("messages", all).put("stream", true);
            }
        });
        PROVIDERS.put("gemini", new Provider() {
            public String base() { return "https://generativelanguage.googleapis.com"; }
            public Map<String, String> headers(String key) { return Collections.singletonMap("x-goog-api-key", key); }
            public String modelsPath() { return "/v1beta/models?pageSize=200"; }
            public List<String> models(JSONObject body) throws JSONException {
                List<String> ids = new ArrayList<>();
                JSONArray models = body.getJSONArray("models");
                for (int i = 0; i < models.length(); i++) {
                    JSONObject model = models.getJSONObject(i);
                    JSONArray methods = model.optJSONArray("supportedGenerationMethods");
                    boolean generates = false;
                    for (int j = 0; methods != null && j < methods.length(); j++) generates |= "generateContent".equals(methods.optString(j));
                    if (generates) ids.add(model.getString("name").replaceFirst("^models/", ""));
                }
                Collections.reverse(ids);
                return ids;
            }
            public String chatPath(String model) {
                try {
                    return "/v1beta/models/" + java.net.URLEncoder.encode(model, "UTF-8") + ":streamGenerateContent?alt=sse";
                } catch (IOException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            public JSONObject chatBody(String model, String system, JSONArray messages) throws JSONException {
                JSONArray contents = new JSONArray();
                for (int i = 0; i < messages.length(); i++) {
                    JSONObject message = messages.getJSONObject(i);
                    contents.put(new JSONObject()
                        .put("role", "assistant".equals(message.getString("role")) ? "model" : "user")
                        .put("parts", new JSONArray().put(new JSONObject().put("text", message.getString("content")))));
                }
                return new JSONObject()
                    .put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", system))))
                    .put("contents", contents);
            }
        });
    }

    private static final String NO_ACCOUNT = "안드로이드 앱에서는 구독 계정으로 연결할 수 없습니다. API 키로 연결하세요";

    private void ai(Request request, OutputStream out) throws IOException, JSONException, Failure {
        String route = request.method + " " + request.path;

        if (route.equals("GET /api/ai/status")) {
            JSONObject status = new JSONObject();
            for (String id : PROVIDERS.keySet()) {
                String key = keys.getString(id, "");
                status.put(id, new JSONObject()
                    .put("connected", !key.isEmpty())
                    .put("hint", key.isEmpty() ? "" : "…" + key.substring(Math.max(0, key.length() - 4)))
                    .put("account", JSONObject.NULL));
            }
            sendJson(out, 200, status);
            return;
        }

        if (route.equals("POST /api/ai/login")) throw new Failure(400, NO_ACCOUNT);

        if (route.equals("POST /api/ai/key")) {
            JSONObject body = request.json();
            String id = body.optString("provider");
            Object key = body.opt("key");
            if (!PROVIDERS.containsKey(id) || !(key instanceof String)) throw new Failure(400, "잘못된 요청입니다");
            String trimmed = ((String) key).trim();
            if (trimmed.isEmpty()) keys.edit().remove(id).apply();
            else keys.edit().putString(id, trimmed).apply();
            sendJson(out, 200, new JSONObject().put("connected", !trimmed.isEmpty()));
            return;
        }

        if (route.equals("GET /api/ai/models")) {
            if ("account".equals(request.query.get("via"))) throw new Failure(400, NO_ACCOUNT);
            String id = request.query.getOrDefault("provider", "");
            Provider provider = PROVIDERS.get(id);
            String key = keys.getString(id, "");
            if (provider == null || key.isEmpty()) throw new Failure(400, "먼저 API 키를 연결하세요");
            HttpURLConnection connection = open(provider.base() + provider.modelsPath(), provider.headers(key));
            connection.setReadTimeout(20000);
            try {
                int status = connection.getResponseCode();
                String text = new String(readAll(bodyOf(connection)), StandardCharsets.UTF_8);
                if (status >= 400) throw new Failure(status, upstreamError(text));
                sendJson(out, 200, new JSONObject().put("models", new JSONArray(provider.models(new JSONObject(text)))));
            } finally {
                connection.disconnect();
            }
            return;
        }

        if (route.equals("POST /api/ai/chat")) {
            JSONObject body = request.json();
            String id = body.optString("provider");
            Provider provider = PROVIDERS.get(id);
            String model = body.optString("model");
            Object system = body.opt("system");
            JSONArray messages = body.optJSONArray("messages");
            boolean valid = provider != null && !model.isEmpty() && system instanceof String && messages != null;
            for (int i = 0; valid && i < messages.length(); i++) {
                JSONObject message = messages.optJSONObject(i);
                valid = message != null && ("user".equals(message.opt("role")) || "assistant".equals(message.opt("role"))) && message.opt("content") instanceof String;
            }
            if (!valid) throw new Failure(400, "잘못된 요청입니다");
            if ("account".equals(body.optString("via"))) throw new Failure(400, NO_ACCOUNT);
            String key = keys.getString(id, "");
            if (key.isEmpty()) throw new Failure(400, "먼저 API 키를 연결하세요");
            HttpURLConnection connection = open(provider.base() + provider.chatPath(model), provider.headers(key));
            try {
                connection.setDoOutput(true);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("content-type", "application/json");
                // 긴 답은 오래 걸리므로 읽기 시간 제한을 넉넉히 둔다.
                connection.setReadTimeout(300000);
                try (OutputStream upstream = connection.getOutputStream()) {
                    upstream.write(provider.chatBody(model, (String) system, messages).toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                if (status >= 400) throw new Failure(status, upstreamError(new String(readAll(bodyOf(connection)), StandardCharsets.UTF_8)));
                // 응답은 오는 대로 그대로 흘려보낸다. 해석은 화면이 한다. 화면이 연결을 끊으면 쓰기에서 오류가 나 여기서 멈춘다.
                writeHead(out, 200, "text/event-stream; charset=utf-8", -1);
                try (InputStream in = connection.getInputStream()) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = in.read(buffer)) >= 0) {
                        out.write(buffer, 0, n);
                        out.flush();
                    }
                } catch (IOException cut) {
                    // 머리를 이미 보냈으니 오류 응답을 따로 보낼 수 없다. 화면은 끊긴 답으로 본다.
                }
            } finally {
                connection.disconnect();
            }
            return;
        }

        throw new Failure(404, "없는 주소입니다");
    }

    private static HttpURLConnection open(String address, Map<String, String> headers) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(20000);
        for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
        return connection;
    }

    /** 회사마다 다른 오류 본문에서 사람이 읽을 문장을 꺼낸다. */
    private static String upstreamError(String text) {
        try {
            Object parsed = text.trim().startsWith("[") ? new JSONArray(text).getJSONObject(0) : new JSONObject(text);
            Object error = ((JSONObject) parsed).opt("error");
            if (error instanceof String) return (String) error;
            if (error instanceof JSONObject && ((JSONObject) error).has("message")) return ((JSONObject) error).getString("message");
        } catch (JSONException | ClassCastException ignored) {
        }
        return text.isEmpty() ? "응답 오류" : text.substring(0, Math.min(300, text.length()));
    }

    private static InputStream bodyOf(HttpURLConnection connection) throws IOException {
        InputStream error = connection.getErrorStream();
        return error != null ? error : connection.getInputStream();
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int n;
        while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
        return out.toByteArray();
    }
}
