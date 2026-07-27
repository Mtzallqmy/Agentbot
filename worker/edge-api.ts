interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ENCRYPTION_MASTER_KEY?: string;
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

    if (url.pathname === "/api/edge/files" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, file_name, content_type, size_bytes, status, created_at FROM stored_files WHERE owner_id = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 100",
      ).bind(user.id).all();
      return json(rows.results);
    }
    if (url.pathname === "/api/edge/files" && request.method === "POST") {
      return uploadFile(request, env, user);
    }
    const fileContentRoute = url.pathname.match(/^\/api\/edge\/files\/([^/]+)\/content$/);
    if (fileContentRoute && request.method === "GET") {
      return downloadFile(fileContentRoute[1], env, user);
    }
    const fileDeleteRoute = url.pathname.match(/^\/api\/edge\/files\/([^/]+)$/);
    if (fileDeleteRoute && request.method === "DELETE") {
      return deleteFile(fileDeleteRoute[1], env, user);
    }

    if (url.pathname === "/api/edge/telegram/status" && request.method === "GET") {
      return telegramStatus(request, env, user);
    }
    if (url.pathname === "/api/edge/telegram/configure" && request.method === "POST") {
      return configureTelegram(request, env, user);
    }
    if (url.pathname === "/api/edge/telegram/configure" && request.method === "DELETE") {
      return disconnectTelegram(env, user);
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
        countOwned(env, "stored_files", user.id),
        telegramConfigured(env, user.id),
      ]);
      return json({
        users: metrics[0],
        conversations: metrics[1],
        jobs: metrics[2],
        failed_jobs: Number(metrics[3]?.value || 0),
        providers: metrics[4],
        files: metrics[5],
        database: 1,
        object_storage: 1,
        edge_api: 1,
        container_worker: 0,
        telegram_webhook: metrics[6] ? 1 : 0,
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
  const baseUrl = normalizeProviderBaseUrl(body.base_url);
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
  const headers = providerHeaders(key);
  const response = await fetch(`${provider.base_url}/models`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  let models: Array<{ id: string }> = [];
  let listingSupported = false;
  if (response.ok) {
    const payload = await response.json() as unknown;
    models = extractModelIds(payload).slice(0, 500).map((modelId) => ({ id: modelId }));
    listingSupported = true;
  } else if (provider.default_model) {
    const probe = await fetch(`${provider.base_url}/chat/completions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: provider.default_model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 3,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!probe.ok) {
      const detail = await safeUpstreamError(probe);
      return problem(502, `فشل توافق المزود (${probe.status}): ${detail}`);
    }
    models = [{ id: provider.default_model }];
  } else {
    return problem(422, "المزود لا يعرض قائمة النماذج. أدخل معرف النموذج الافتراضي ثم أعد الاختبار.");
  }
  const now = new Date().toISOString();
  for (const model of models) {
    await env.DB.prepare(
      "INSERT INTO ai_models (id, provider_id, model_id, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET updated_at = excluded.updated_at",
    ).bind(crypto.randomUUID(), id, model.id, now, now).run();
  }
  if (!provider.default_model && models[0]?.id) {
    await env.DB.prepare("UPDATE ai_providers SET default_model = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(models[0].id, now, id, user.id).run();
  }
  await audit(env, user.id, "provider.test", "ai_provider", id, { models_count: models.length });
  return json({
    ok: true,
    models_count: models.length,
    models: models.map((model) => model.id),
    listing_supported: listingSupported,
    default_model: provider.default_model || models[0]?.id || null,
  });
}

async function createMessage(conversationId: string, request: Request, env: Env, user: AuthUser): Promise<Response> {
  const conversation = await env.DB.prepare(
    "SELECT c.id, c.provider_id, c.model_id FROM conversations c WHERE c.id = ? AND c.owner_id = ?",
  ).bind(conversationId, user.id).first<{ id: string; provider_id: string | null; model_id: string | null }>();
  if (!conversation) return problem(404, "المحادثة غير موجودة.");
  const body = await bodyJson<{ content?: string; attachment_ids?: string[]; provider_id?: string; model_id?: string }>(request);
  const content = cleanText(body.content, 50000);
  const attachmentIds = Array.isArray(body.attachment_ids)
    ? [...new Set(body.attachment_ids.filter((value) => typeof value === "string"))].slice(0, 8)
    : [];
  if (!content && attachmentIds.length === 0) return problem(422, "اكتب رسالة أو أرفق ملفاً.");

  let providerId = cleanText(body.provider_id, 80) || conversation.provider_id;
  if (!providerId) {
    const first = await env.DB.prepare(
      "SELECT id FROM ai_providers WHERE owner_id = ? AND enabled = 1 ORDER BY created_at LIMIT 1",
    ).bind(user.id).first<{ id: string }>();
    providerId = first?.id || null;
  }
  if (!providerId) return problem(409, "أضف مزود ذكاء اصطناعي واختبره أولاً.");
  const provider = await ownedProvider(providerId, env, user);
  if (!provider) return problem(409, "المزود المحدد غير متاح.");
  const model = cleanText(body.model_id, 180) || conversation.model_id || provider.default_model;
  if (!model) return problem(409, "حدد نموذجاً افتراضياً للمزود.");

  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, status, created_at, updated_at) VALUES (?, ?, 'user', ?, 'completed', ?, ?)",
  ).bind(userMessageId, conversationId, content || "مرفقات", now, now).run();
  const attachmentContent = await buildAttachmentContent(attachmentIds, env, user, userMessageId);
  const history = await env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 30",
  ).bind(conversationId).all<{ role: string; content: string }>();
  const messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [...history.results].reverse();
  if (attachmentContent.length > 0) {
    messages[messages.length - 1] = {
      role: "user",
      content: [
        ...(content ? [{ type: "text", text: content }] : []),
        ...attachmentContent,
      ],
    };
  }
  const key = await decryptSecret(provider.encrypted_key, requiredKey(env));
  const started = Date.now();
  const upstream = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { ...providerHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(90000),
  });
  let payload: {
    id?: string;
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  try {
    payload = await upstream.json() as typeof payload;
  } catch {
    return problem(502, `أعاد المزود استجابة غير صالحة بصيغة غير JSON (HTTP ${upstream.status}).`);
  }
  if (!upstream.ok) return problem(502, `فشل المزود بالحالة ${upstream.status}: ${cleanText(payload.error?.message, 180) || "خطأ منقّح"}`);
  const answer = normalizeAssistantContent(payload.choices?.[0]?.message?.content);
  if (!answer) return problem(502, "اتصل المزود لكنه لم يُرجع محتوى نصياً قابلاً للعرض.");
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, provider_request_id, prompt_tokens, completion_tokens, latency_ms, status, created_at, updated_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, 'completed', ?, ?)",
  ).bind(crypto.randomUUID(), conversationId, answer, payload.id || null, payload.usage?.prompt_tokens || null, payload.usage?.completion_tokens || null, Date.now() - started, now, now).run();
  await env.DB.prepare("UPDATE conversations SET provider_id = ?, model_id = ?, updated_at = ? WHERE id = ?")
    .bind(providerId, model, now, conversationId).run();
  return json({ content: answer, model, usage: payload.usage || null });
}

async function telegramWebhook(request: Request, env: Env): Promise<Response> {
  const credentials = await loadTelegramCredentials(env);
  if (!credentials) return problem(503, "تكامل Telegram غير مهيأ.");
  if (!constantTimeEqual(request.headers.get("x-telegram-bot-api-secret-token") || "", credentials.webhookSecret)) {
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
    await fetch(`https://api.telegram.org/bot${credentials.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
  }
  return json({ ok: true });
}

async function configureTelegram(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await bodyJson<{ token?: string }>(request);
  const botToken = body.token?.trim() || "";
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    return problem(422, "صيغة توكن Telegram غير صحيحة.");
  }
  const meResponse = await telegramApi(botToken, "getMe");
  const me = await meResponse.json() as { ok?: boolean; result?: { id?: number; username?: string; first_name?: string }; description?: string };
  if (!meResponse.ok || !me.ok || !me.result?.id) {
    return problem(422, `رفض Telegram التوكن: ${cleanText(me.description, 160) || "بيانات غير صالحة"}`);
  }

  const webhookSecret = randomSecret(32);
  const webhookUrl = `${new URL(request.url).origin}/api/telegram/webhook`;
  const webhookResponse = await telegramApi(botToken, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  const webhookPayload = await webhookResponse.json() as { ok?: boolean; description?: string };
  if (!webhookResponse.ok || !webhookPayload.ok) {
    return problem(502, `تعذر تسجيل Webhook: ${cleanText(webhookPayload.description, 160) || "خطأ Telegram"}`);
  }

  const now = new Date().toISOString();
  await upsertSecretSetting(env, user.id, "telegram_bot_token", botToken, now);
  await upsertSecretSetting(env, user.id, "telegram_webhook_secret", webhookSecret, now);
  await env.DB.prepare(
    "INSERT INTO system_settings (id, owner_id, setting_key, value_json, created_at, updated_at) VALUES (?, ?, 'telegram_bot_profile', ?, ?, ?) ON CONFLICT(owner_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  ).bind(
    crypto.randomUUID(),
    user.id,
    JSON.stringify({ id: me.result.id, username: me.result.username || null, first_name: me.result.first_name || null, webhook_url: webhookUrl }),
    now,
    now,
  ).run();
  await audit(env, user.id, "telegram.configure", "telegram_bot", String(me.result.id), { username: me.result.username || null });
  return json({ ok: true, username: me.result.username || null, bot_id: me.result.id, webhook_url: webhookUrl });
}

async function telegramStatus(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const profile = await env.DB.prepare(
    "SELECT value_json FROM system_settings WHERE owner_id = ? AND setting_key = 'telegram_bot_profile'",
  ).bind(user.id).first<{ value_json: string | null }>();
  const configured = await telegramConfigured(env, user.id);
  if (!configured) return json({ configured: false, webhook_ok: false });
  const tokenRow = await env.DB.prepare(
    "SELECT encrypted_value FROM system_settings WHERE owner_id = ? AND setting_key = 'telegram_bot_token'",
  ).bind(user.id).first<{ encrypted_value: string }>();
  if (!tokenRow?.encrypted_value) return json({ configured: false, webhook_ok: false });
  const botToken = await decryptSecret(tokenRow.encrypted_value, requiredKey(env));
  const response = await telegramApi(botToken, "getWebhookInfo");
  const payload = await response.json() as {
    ok?: boolean;
    result?: { url?: string; pending_update_count?: number; last_error_message?: string };
  };
  const saved = profile?.value_json ? JSON.parse(profile.value_json) as Record<string, unknown> : {};
  const expectedUrl = `${new URL(request.url).origin}/api/telegram/webhook`;
  return json({
    configured: true,
    username: saved.username || null,
    webhook_ok: Boolean(payload.ok && payload.result?.url === expectedUrl),
    pending_updates: payload.result?.pending_update_count || 0,
    last_error: cleanText(payload.result?.last_error_message, 160) || null,
  });
}

async function disconnectTelegram(env: Env, user: AuthUser): Promise<Response> {
  const tokenRow = await env.DB.prepare(
    "SELECT encrypted_value FROM system_settings WHERE owner_id = ? AND setting_key = 'telegram_bot_token'",
  ).bind(user.id).first<{ encrypted_value: string }>();
  if (tokenRow?.encrypted_value) {
    const botToken = await decryptSecret(tokenRow.encrypted_value, requiredKey(env));
    await telegramApi(botToken, "deleteWebhook", { drop_pending_updates: false });
  }
  await env.DB.prepare(
    "DELETE FROM system_settings WHERE owner_id = ? AND setting_key IN ('telegram_bot_token', 'telegram_webhook_secret', 'telegram_bot_profile')",
  ).bind(user.id).run();
  await audit(env, user.id, "telegram.disconnect", "telegram_bot");
  return json({ ok: true });
}

const allowedUploadTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

async function uploadFile(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data")) return problem(415, "يجب رفع الملف بصيغة multipart/form-data.");
  const form = await request.formData();
  const item = form.get("file");
  if (!(item instanceof File)) return problem(422, "لم يُرسل ملف.");
  if (item.size <= 0 || item.size > 10 * 1024 * 1024) return problem(413, "حجم الملف يجب ألا يتجاوز 10 ميجابايت.");
  if (!allowedUploadTypes.has(item.type)) return problem(415, "نوع الملف غير مسموح. الأنواع المدعومة: صور، PDF، TXT، Markdown، CSV وJSON.");

  const id = crypto.randomUUID();
  const safeName = sanitizeFileName(item.name);
  const objectKey = `${user.id}/${id}/${safeName}`;
  await env.BUCKET.put(objectKey, item.stream(), {
    httpMetadata: { contentType: item.type },
    customMetadata: { owner_id: user.id, file_id: id },
  });
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO stored_files (id, owner_id, object_key, file_name, content_type, size_bytes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)",
    ).bind(id, user.id, objectKey, safeName, item.type, item.size, now, now).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
  await audit(env, user.id, "file.upload", "stored_file", id, { content_type: item.type, size_bytes: item.size });
  return json({
    id,
    file_name: safeName,
    content_type: item.type,
    size_bytes: item.size,
    content_url: `/api/edge/files/${id}/content`,
  }, 201);
}

async function downloadFile(id: string, env: Env, user: AuthUser): Promise<Response> {
  const file = await ownedFile(id, env, user);
  if (!file) return problem(404, "الملف غير موجود.");
  const object = await env.BUCKET.get(file.object_key);
  if (!object) return problem(404, "بيانات الملف غير موجودة في التخزين.");
  return new Response(object.body, {
    headers: {
      "content-type": file.content_type,
      "content-length": String(file.size_bytes),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function deleteFile(id: string, env: Env, user: AuthUser): Promise<Response> {
  const file = await ownedFile(id, env, user);
  if (!file) return problem(404, "الملف غير موجود.");
  await env.BUCKET.delete(file.object_key);
  await env.DB.prepare("UPDATE stored_files SET status = 'deleted', updated_at = ? WHERE id = ? AND owner_id = ?")
    .bind(new Date().toISOString(), id, user.id).run();
  await audit(env, user.id, "file.delete", "stored_file", id);
  return json({ ok: true });
}

async function buildAttachmentContent(ids: string[], env: Env, user: AuthUser, messageId: string): Promise<Array<Record<string, unknown>>> {
  const content: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const file = await ownedFile(id, env, user);
    if (!file) throw new Error(`attachment_not_found:${id}`);
    const object = await env.BUCKET.get(file.object_key);
    if (!object) throw new Error(`attachment_bytes_missing:${id}`);
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO message_attachments (id, message_id, file_id, kind, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), messageId, id, file.content_type.startsWith("image/") ? "image" : "file", createdAt).run();

    if (file.content_type.startsWith("image/")) {
      if (file.size_bytes > 5 * 1024 * 1024) throw new Error("image_too_large_for_model");
      const bytes = new Uint8Array(await object.arrayBuffer());
      content.push({
        type: "image_url",
        image_url: { url: `data:${file.content_type};base64,${toBase64(bytes)}` },
      });
      continue;
    }
    if (["text/plain", "text/markdown", "text/csv", "application/json"].includes(file.content_type)) {
      const textBody = (await object.text()).slice(0, 60000);
      content.push({ type: "text", text: `محتوى الملف ${file.file_name}:\n${textBody}` });
      continue;
    }
    content.push({ type: "text", text: `أُرفق ملف باسم ${file.file_name} من النوع ${file.content_type}.` });
  }
  return content;
}

async function ownedFile(id: string, env: Env, user: AuthUser) {
  return env.DB.prepare(
    "SELECT id, object_key, file_name, content_type, size_bytes FROM stored_files WHERE id = ? AND owner_id = ? AND status = 'ready'",
  ).bind(id, user.id).first<{
    id: string;
    object_key: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
  }>();
}

async function loadTelegramCredentials(env: Env): Promise<{ botToken: string; webhookSecret: string } | null> {
  const rows = await env.DB.prepare(
    "SELECT setting_key, encrypted_value FROM system_settings WHERE owner_id = (SELECT owner_id FROM system_settings WHERE setting_key = 'telegram_bot_token' ORDER BY updated_at DESC LIMIT 1) AND setting_key IN ('telegram_bot_token', 'telegram_webhook_secret') AND encrypted_value IS NOT NULL",
  ).all<{ setting_key: string; encrypted_value: string }>();
  const values = new Map(rows.results.map((row) => [row.setting_key, row.encrypted_value]));
  const token = values.get("telegram_bot_token");
  const secret = values.get("telegram_webhook_secret");
  if (!token || !secret) return null;
  const master = requiredKey(env);
  return {
    botToken: await decryptSecret(token, master),
    webhookSecret: await decryptSecret(secret, master),
  };
}

async function telegramConfigured(env: Env, ownerId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS value FROM system_settings WHERE owner_id = ? AND setting_key IN ('telegram_bot_token', 'telegram_webhook_secret') AND encrypted_value IS NOT NULL",
  ).bind(ownerId).first<{ value: number }>();
  return Number(row?.value || 0) === 2;
}

async function upsertSecretSetting(env: Env, ownerId: string, settingKey: string, value: string, now: string) {
  const encrypted = await encryptSecret(value, requiredKey(env));
  await env.DB.prepare(
    "INSERT INTO system_settings (id, owner_id, setting_key, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, setting_key) DO UPDATE SET encrypted_value = excluded.encrypted_value, value_json = NULL, updated_at = excluded.updated_at",
  ).bind(crypto.randomUUID(), ownerId, settingKey, encrypted, now, now).run();
}

async function telegramApi(token: string, method: string, payload?: Record<string, unknown>): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(15000),
  });
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

async function countOwned(env: Env, table: "conversations" | "background_jobs" | "ai_providers" | "stored_files", ownerId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE owner_id = ?`).bind(ownerId).first<{ value: number }>();
  return Number(row?.value || 0);
}

async function bodyJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new Error("request_too_large");
  return request.json<T>();
}

function normalizeProviderBaseUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    if (host === "localhost" || host.endsWith(".local") || host === "169.254.169.254" || isPrivateIp(host)) return null;
    url.pathname = url.pathname
      .replace(/\/(chat\/completions|completions|models)\/?$/i, "")
      .replace(/\/+$/, "");
    if (!url.pathname || url.pathname === "/") url.pathname = "/v1";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function providerHeaders(key: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    accept: "application/json",
    "user-agent": "MidadAI/1.0",
  };
}

function extractModelIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => typeof item === "string" ? item : isRecord(item) ? String(item.id || item.name || "") : "").filter(Boolean);
  }
  if (!isRecord(payload)) return [];
  const list = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload.result)
        ? payload.result
        : [];
  return list
    .map((item) => typeof item === "string" ? item : isRecord(item) ? String(item.id || item.name || item.model || "") : "")
    .filter(Boolean);
}

function normalizeAssistantContent(value: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
}

async function safeUpstreamError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as unknown;
    if (isRecord(payload)) {
      const error = payload.error;
      if (typeof error === "string") return cleanText(error, 180);
      if (isRecord(error) && typeof error.message === "string") return cleanText(error.message, 180);
      if (typeof payload.message === "string") return cleanText(payload.message, 180);
      if (typeof payload.detail === "string") return cleanText(payload.detail, 180);
    }
  } catch {
    return `HTTP ${response.status}`;
  }
  return `HTTP ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function sanitizeFileName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\/\\\u0000-\u001f\u007f]+/g, "_").trim();
  return (normalized || "file").slice(0, 120);
}

function randomSecret(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
