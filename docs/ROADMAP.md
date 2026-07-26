# خارطة التنفيذ المرحلية

كل مرحلة تنتهي بـlint/typecheck/tests، تحديث الوثائق، ونسخة قابلة للتشغيل. لا تُعد خاصية مكتملة إن كان اختبارها يحتاج اعتماداً غير متوفر؛ توسم `blocked_external`.

## المرحلة 1 — التحليل والمعمارية

- [x] PRD وMVP.
- [x] معمارية وحدود أمن.
- [x] Schema وتدفقات ومخاطر.
- [x] شجرة مستهدفة وقرارات تقنية.

**بوابة الخروج:** وثائق متسقة ونطاق MVP قابل للتقسيم.

## المرحلة 2 — الأساس البرمجي

- [ ] Monorepo، FastAPI، settings وstructured logging.
- [ ] SQLAlchemy Async + Alembic + PostgreSQL.
- [ ] Redis/ARQ وسجل jobs الدائم.
- [ ] auth، sessions، users، RBAC، audit.
- [ ] Docker Compose وhealth/readiness.

**اختبار الخروج:** migration من قاعدة فارغة، auth/API integration، restart worker recovery.

## المرحلة 3 — Telegram

- [ ] aiogram routers وFSM في Redis.
- [ ] Webhook secret/idempotency وscripts.
- [ ] قائمة RTL، pagination، cancel/errors.

**اختبار الخروج:** update مكرر لا ينتج أثراً ثانياً وWebhook يعود سريعاً.

## المرحلة 4 — AI

- [ ] SecretCipher وSSRF guard.
- [ ] OpenAI-compatible Adapter واكتشاف القدرات.
- [ ] test/list/manual model.
- [ ] conversation persistence وSSE/cancel/usage.
- [ ] Telegram + Web chat.

**اختبار الخروج:** Adapter وهمي داخل الاختبار ومسار حي اختياري بمفتاح خارجي.

## المرحلة 5 — الوسائط

- [ ] metadata/formats عبر yt-dlp.
- [ ] FFmpeg download/convert/trim/split sandbox.
- [ ] progress/cancel/retry/cleanup وS3 delivery.

**اختبار الخروج:** ملف مولد محلياً، قص وتحويل والتحقق بـffprobe.

## المرحلة 6 — Agent Workspace

- [ ] projects/runs/steps، Orchestrator وحدود الميزانية.
- [ ] Tool Registry وصلاحيات/تدقيق.
- [ ] container sandbox وfile/git/test tools.
- [ ] approval workflow.
- [ ] GitHub OAuth/App وbranch/commit/PR.

**اختبار الخروج:** مشروع fixture يعدل ويختبر؛ push/PR mocked، والمسار الحي يتطلب موافقة واعتماد.

## المرحلة 7 — واجهة الويب

- [ ] auth، chat، provider settings.
- [ ] agent plan/logs/files/diff/approval.
- [ ] media jobs/files/integrations/usage.
- [ ] RTL responsive، loading/error/empty states.

**اختبار الخروج:** Playwright للمسارات الحرجة ضد Backend حقيقي محلي.

## المرحلة 8 — الإدارة

- [ ] metrics حقيقية، users/jobs/audit/quotas/flags.
- [ ] export CSV/JSON وsafe retry.

**اختبار الخروج:** RBAC يمنع user، والأرقام تطابق fixtures في DB.

## المرحلة 9 — التقوية

- [ ] security tests، SSRF/path traversal/command injection/redaction.
- [ ] rate/concurrency limits، load tests، backup/restore.
- [ ] coverage للمسارات الحساسة ومراجعة التبعيات.

## المرحلة 10 — جاهزية الإنتاج

- [ ] CI build/test/audit/Trivy/migration validation.
- [ ] صور non-root وreverse proxy/HTTPS docs.
- [ ] Prometheus/Grafana/alerts وsmoke test.
- [ ] دليل VPS وContainer Hosting وخطة rollback.
- [ ] GitHub Actions deploy اختياري محمي بـenvironment approval.

## ما بعد MVP حسب الأولوية

1. Anthropic/Gemini native adapters.
2. PostgreSQL RLS مفعّل واختبارات عزله.
3. أدوات قواعد بيانات إضافية في read-only.
4. Autoscaling وKubernetes.
5. ذاكرة/RAG اختيارية ومشفرة.

