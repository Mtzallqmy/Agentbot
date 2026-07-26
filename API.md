# API

الـAPI مبني على FastAPI. عند تشغيله مباشرة في Development تتوفر وثائق OpenAPI
عبر `/docs` والمخطط في `/openapi.json`. مسارات الأعمال تبدأ بـ`/api/v1` ويحافظ
Nginx على هذا الـprefix عند تمريرها إلى الخدمة.

## قواعد التكامل

- JSON افتراضياً، وUTC بصيغة ISO-8601 للتواريخ.
- JWT قصير العمر في Cookie `HttpOnly` قابلة للإبطال من جدول الجلسات. تدوير
  Refresh Tokens متعدد الأجهزة مؤجل للمرحلة التالية.
- كل طلب يستقبل/يعيد `X-Request-ID` للتتبع.
- مهام الوسائط والوكيل تقبل `idempotency_key` في جسم JSON؛ Webhook يستخدم
  `update_id` كمفتاح idempotency.
- أخطاء المزود تستخدم `code` و`message` المنقحين؛ بقية أخطاء FastAPI تستخدم
  `detail` وتعيد `X-Request-ID`.
- Streaming يستخدم SSE؛ يجب ألا تقوم الـproxy buffering بحجبه.

## نقاط تشغيل أساسية

| المسار | الغرض |
|---|---|
| `GET /health` | Liveness عند الاتصال المباشر بالخدمة |
| `GET /readiness` | Readiness عند الاتصال المباشر بالخدمة |
| `POST /api/v1/telegram/webhook` | Telegram webhook مع secret-token |
| `POST /api/v1/auth/login` | إنشاء جلسة المالك |
| `GET /api/v1/auth/me` | فحص الجلسة الحالية |
| `POST /api/v1/auth/logout` | إبطال الجلسة |
| `GET/POST /api/v1/providers` | قائمة/إضافة مزود مشفر |
| `POST /api/v1/providers/{id}/test` | اختبار المزود |
| `GET /api/v1/providers/{id}/models` | جلب النماذج |
| `GET/POST /api/v1/conversations` | المحادثات |
| `POST /api/v1/conversations/{id}/messages` | رد SSE |
| `POST /api/v1/media/analyze` | مهمة تحليل رابط |
| `POST /api/v1/media/jobs` | مهمة تنزيل/تحويل/قص |
| `GET /api/v1/jobs/{id}` | حالة وتقدم المهمة |
| `POST /api/v1/jobs/{id}/cancel` | طلب إلغاء |
| `GET /api/v1/jobs/{id}/download` | تنزيل مخرج مملوك للمستخدم |
| `GET/POST /api/v1/agent/projects` | مشاريع الوكيل |
| `POST /api/v1/agent/projects/{id}/runs` | تشغيل خطة MVP |
| `GET /api/v1/admin/metrics` | أرقام حقيقية من قاعدة البيانات |
| `GET /metrics` | Prometheus عبر الشبكة الداخلية فقط |

تفاصيل موارد providers، conversations، jobs، agents، media وadmin يُعد مصدرها
الحقيقي مخطط OpenAPI المولّد من التطبيق. لا تُضمّن API keys في query strings؛
أرسلها مرة عبر endpoint محمي، ثم يعرض النظام آخر أربعة أحرف فقط.
