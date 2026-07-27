interface Env {
  DB: D1Database;
  ENCRYPTION_MASTER_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

type AuthUser = { id: string; email: string; fullName: string | null; role: string };

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function handleEdgeApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/edge/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ status: "ok", database: "connected", runtime: "cloudflare-edge" });
  }
  if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
    return telegramWebhook(request, env);
  }
  if (!url.pathname.startsWith("/api/edge/")) return null;

  const user = await authenticate(request, env);
  if (!user) return problem(401, "يلزم تسجيل الدخول عبر المنصة.");

  try {
    if (url.pathname === "/api/edge/me" && request.method === "GET") return json(user);
    if (url.pathname === "/api/edge/providers" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, name, base_url, compatibility, key_hint, default_model, enabled, created_at FROM ai_providers WHERE owner_id = ? ORDER BY created_at DESC",
      ).bind(user.id).all();
      return json(rows.results);
    }
    if (url.pathname === "/api/edge/providers" && request.method === "POST") {
      return createProvider(request, env, user);
    }

    const providerTest = url.pathname.match(/^\/api\/edge\/providers\/([^/]+)\/test$/);
    if (providerTest && request.method === "POST") return testProvider(providerTest[1], env, user);

    if (url.pathname === "/api/edge/conversations" && request.method === "POST") {
      const body = await bodyJson<{ title?: string; provider_id?: string; model_id?: string }>(request);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO conversations (id, owner_id, title, provider_id, model_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      ).bind(id, user.id, cleanText(body.title, 120) || "محادثة جديدة", body.provider_id || null, body.model_id || null, now, now).run();
      await audit(env, user.id, "conversation.create", "conversation", id);
      return json({ id }, 201);
    }

    const messageRoute = url.pathname.match(/^\/api\/edge\/conversations\/([^/]+)\/messages$/);
    if (messageRoute && request.method === "POST") return createMessage(messageRoute[1], request, env, user);

    if (url.pathname === "/api/edge/agent/projects" && request.method === "POST") {
      const body = await bodyJson<{ name?: string }>(request);
      const name = cleanText(body.name, 80);
      if (!name) return problem(422, "اسم المشروع مطلوب.");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO agent_projects (id, owner_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).bind(id, user.id, name, now, now).run();
      await audit(env, user.id, "agent_project.create", "agent_project", id);
      return json({ id }, 201);
    }

    const runRoute = url.pathname.match(/^\/api\/edge\/agent\/projects\/([^/]+)\/runs$/);
    if (runRoute && request.method === "POST") {
      const project = await env.DB.prepare("SELECT id FROM agent_projects WHERE id = ? AND owner_id = ?")
        .bind(runRoute[1], user.id).first();
      if (!project) return problem(404, "المشروع غير موجود.");
      const body = await bodyJson<{ instruction?: string }>(request);
      const instruction = cleanText(body.instruction, 4000);
      if (!instruction) return problem(422, "تعليمة التشغيل مطلوبة.");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO agent_runs (id, project_id, instruction, status, progress, created_at, updated_at) VALUES (?, ?, ?, 'waiting_for_worker', 0, ?, ?)",
      ).bind(id, runRoute[1], instruction, now, now).run();
      await audit(env, user.id, "agent_run.create", "agent_run", id);
      return json({ id, status: "waiting_for_worker" }, 202);
    }

    if (url.pathname === "/api/edge/media/analyze" || url.pathname === "/api/edge/media/jobs") {
      return problem(503, "معالجة الوسائط تحتاج Worker حاويات دائم؛ لم يتم ربطه بهذه النسخة بعد.");
    }

    if (url.pathname === "/api/edge/admin/metrics" && request.method === "GET") {
      const metrics = await Promise.all([
        count(env, "users"),
        countOwned(env, "conversations", user.id),
        countOwned(env, "background_jobs", user.id),
        env.DB.prepare("SELECT COUNT(*) AS value FROM background_jobs WHERE owner_id = ? AND status = 'failed'").bind(user.id).first<{ value: number }>(),
        countOwned(env, "ai_providers", user.id),
      ]);
      return json({
        users: metrics[0],
        conversations: metrics[1],
        jobs: metrics[2],
        failed_jobs: Number(metrics[3]?.value || 0),
        providers: metrics[4],
        database: 1,
        edge_api: 1,
        container_worker: 0,
        telegram_webhook: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET ? 1 : 0,
      });
    }
    return problem(404, "المسار غير موجود.");
  } catch (error) {
    console.error("edge_api_error", safeError(error));
    return problem(500, "حدث خطأ داخلي منقّح. راجع سجل التشغيل.");
  }
}

async function authenticate(request: Request, env: Env): Promise<AuthUser | null> {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const fullName = encodedName ? safeDecode(encodedName) : null;
  const existing = await env.DB.prepare("SELECT id, email, full_name AS fullName, role FROM users WHERE email = ?")
    .bind(email).first<AuthUser>();
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, full_name, role, created_at, updated_at) VALUES (?, ?, ?, 'superadmin', ?, ?)",
  ).bind(id, email, fullName, now, now).run();
  await audit(env, id, "user.bootstrap", "user", id);
  return { id, email, fullName, role: "superadmin" };
}

async function createProvider(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!env.ENCRYPTION_MASTER_KEY) return problem(503, "لم يُضبط مفتاح التشفير الرئيسي في أسرار Sites.");
  const body = await bodyJson<{ name?: string; base_url?: string; api_key?: string; compatibility?: string; default_model?: string }>(request);
  const name = cleanText(body.name, 80);
  const apiKey = body.api_key?.trim();
  const baseUrl = validateExternalHttpsUrl(body.base_url);
  if (!name || !apiKey || !baseUrl) return problem(422, "تحقق من الاسم وBase URL الآمن والمفتاح.");
  const encrypted = await encryptSecret(apiKey, env.ENCRYPTION_MASTER_KEY);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ai_providers (id, owner_id, name, base_url, compatibility, encrypted_key, key_hint, default_model, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).bind(id, user.id, name, baseUrl, body.compatibility === "openai" ? "openai" : "openai", encrypted, `••••${apiKey.slice(-4)}`, cleanText(body.default_model, 160) || null, now, now).run();
  await audit(env, user.id, "provider.create", "ai_provider", id);
  return json({ id, name, base_url: baseUrl, key_hint: `••••${apiKey.slice(-4)}` }, 201);
}

async function testProvider(id: string, env: Env, user: AuthUser): Promise<Response> {
  const provider = await ownedProvider(id, env, user);
  if (!provider) return problem(404, "المزود غير موجود.");
  const key = await decryptSecret(provider.encrypted_key, requiredKey(env));
  const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return problem(502, `رفض المزود الاختبار بالحالة ${response.status}.`);
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data || []).filter((item) => item.id).slice(0, 500);
  const now = new Date().toISOString();
  for (const model of models) {
    await env.DB.prepare(
      "INSERT INTO ai_models (id, provider_id, model_id, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET updated_at = excluded.updated_at",
    ).bind(crypto.randomUUID(), id, model.id, now, now).run();
  }
  await audit(env, user.id, "provider.test", "ai_provider", id, { models_count: models.length });
  return json({ ok: true, models_count: models.length });
}

async function createMessage(conversationId: string, request: Request, env: Env, user: AuthUser): Promise<Response> {
  const conversation = await env.DB.prepare(
    "SELECT c.id, c.provider_id, c.model_id FROM conversations c WHERE c.id = ? AND c.owner_id = ?",
  ).bind(conversationId, user.id).first<{ id: string; provider_id: string | null; model_id: string | null }>();
  if (!conversation) return problem(404, "المحادثة غير موجودة.");
  const body = await bodyJson<{ content?: string }>(request);
  const content = cleanText(body.content, 50000);
  if (!content) return problem(422, "محتوى الرسالة مطلوب.");

  let providerId = conversation.provider_id;
  if (!providerId) {
    const first = await env.DB.prepare(
      "SELECT id FROM ai_providers WHERE owner_id = ? AND enabled = 1 ORDER BY created_at LIMIT 1",
    ).bind(user.id).first<{ id: string }>();
    providerId = first?.id || null;
  }
  if (!providerId) return problem(409, "أضف مزود ذكاء اصطناعي واختبره أولاً.");
  const provider = await ownedProvider(providerId, env, user);
  if (!provider) return problem(409, "المزود المحدد غير متاح.");
  const model = conversation.model_id || provider.default_model;
  if (!model) return problem(409, "حدد نموذجاً افتراضياً للمزود.");

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, status, created_at, updated_at) VALUES (?, ?, 'user', ?, 'completed', ?, ?)",
  ).bind(crypto.randomUUID(), conversationId, content, now, now).run();
  const history = await env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 30",
  ).bind(conversationId).all<{ role: string; content: string }>();
  const messages = [...history.results].reverse();
  const key = await decryptSecret(provider.encrypted_key, requiredKey(env));
  const started = Date.now();
  const upstream = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(90000),
  });
  const payload = await upstream.json() as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!upstream.ok) return problem(502, `فشل المزود بالحالة ${upstream.status}: ${cleanText(payload.error?.message, 180) || "خطأ منقّح"}`);
  const answer = payload.choices?.[0]?.message?.content || "";
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, provider_request_id, prompt_tokens, completion_tokens, latency_ms, status, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, 'completed', ?, ?)",
  ).bind(crypto.randomUUID(), conversationId, answer, payload.id || null, payload.usage?.prompt_tokens || null, payload.usage?.completion_tokens || null, Date.now() - started, now, now).run();
  await env.DB.prepare("UPDATE conversations SET provider_id = ?, model_id = ?, updated_at = ? WHERE id = ?")
    .bind(providerId, model, now, conversationId).run();
  return json({ content: answer, model, usage: payload.usage || null });
}

async function telegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return problem(503, "تكامل Telegram غير مهيأ.");
  if (!constantTimeEqual(request.headers.get("x-telegram-bot-api-secret-token") || "", env.TELEGRAM_WEBHOOK_SECRET)) {
    return problem(401, "Webhook secret غير صالح.");
  }
  const update = await bodyJson<{ update_id?: number; message?: { chat?: { id?: number }; text?: string } }>(request);
  if (!Number.isInteger(update.update_id)) return problem(422, "update_id غير صالح.");
  try {
    await env.DB.prepare("INSERT INTO telegram_updates (update_id, received_at) VALUES (?, ?)")
      .bind(update.update_id, new Date().toISOString()).run();
  } catch {
    return json({ ok: true, duplicate: true });
  }
  const chatId = update.message?.chat?.id;
  if (chatId) {
    const text = update.message?.text?.startsWith("/start")
      ? "مرحباً بك في مِداد AI. افتح المنصة لإدارة المحادثات والمزودات والمهام بأمان."
      : "تم استلام رسالتك. إدارة الذكاء الاصطناعي والوكيل متاحة من منصة مِداد.";
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
  }
  return json({ ok: true });
}

async function ownedProvider(id: string, env: Env, user: AuthUser) {
  return env.DB.prepare(
    "SELECT id, base_url, encrypted_key, default_model FROM ai_providers WHERE id = ? AND owner_id = ? AND enabled = 1",
  ).bind(id, user.id).first<{ id: string; base_url: string; encrypted_key: string; default_model: string | null }>();
}

async function audit(env: Env, actorId: string | null, action: string, resourceType: string, resourceId?: string, metadata: unknown = {}) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, actor_id, action, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), actorId, action, resourceType, resourceId || null, JSON.stringify(metadata), new Date().toISOString()).run();
}

async function count(env: Env, table: "users") {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS value FROM ${table}`).first<{ value: number }>();
  return Number(row?.value || 0);
}

async function countOwned(env: Env, table: "conversations" | "background_jobs" | "ai_providers", ownerId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE owner_id = ?`).bind(ownerId).first<{ value: number }>();
  return Number(row?.value || 0);
}

async function bodyJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new Error("request_too_large");
  return request.json<T>();
}

function validateExternalHttpsUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    if (host === "localhost" || host.endsWith(".local") || host === "169.254.169.254" || isPrivateIp(host)) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isPrivateIp(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

async function encryptSecret(value: string, master: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", decodeMasterKey(master), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value: string, master: string): Promise<string> {
  const [ivValue, cipherValue] = value.split(".");
  if (!ivValue || !cipherValue) throw new Error("invalid_ciphertext");
  const key = await crypto.subtle.importKey("raw", decodeMasterKey(master), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivValue) }, key, fromBase64(cipherValue));
  return new TextDecoder().decode(decrypted);
}

function decodeMasterKey(value: string): Uint8Array {
  const decoded = fromBase64(value);
  if (decoded.byteLength !== 32) throw new Error("invalid_master_key");
  return decoded;
}

function requiredKey(env: Env): string {
  if (!env.ENCRYPTION_MASTER_KEY) throw new Error("missing_master_key");
  return env.ENCRYPTION_MASTER_KEY;
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function safeDecode(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/(bearer|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]").slice(0, 300) : "unknown";
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function problem(status: number, detail: string): Response {
  return json({ error: status >= 500 ? "service_error" : "request_error", detail }, status);
}
