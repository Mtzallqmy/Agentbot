# منصة الوكيل الذكي

منصة عربية متعددة الواجهات تجمع دردشة AI قابلة لتوسعة المزودين، بوت Telegram
عبر Webhook، مهام وسائط معزولة، وAgent Workspace بصلاحيات وموافقات. التصميم
Modular Monolith في FastAPI مع Worker مستقل، إضافة إلى نشر Sites يعمل بـEdge
API وD1 وواجهة Vinext/Next داعمة لـRTL.

> حالة المشروع: تنفيذ MVP جارٍ على مراحل. لا تعمل التكاملات الخارجية حتى تضبط
> بيانات اعتمادها. لا توجد مفاتيح افتراضية، ولا يدّعي المشروع دعم مصدر وسائط أو
> مزود AI قبل اختباره فعلياً.

## البنية

```text
apps/
  api/       FastAPI والوحدات والمصادقة وWebhook
  bot/       aiogram وتجربة Telegram
  worker/    المهام الخلفية والوسائط والوكيل
packages/    العقود والأدوات المشتركة
app/         واجهة Vinext/Next
infrastructure/
  docker/    صور Backend وWeb
  nginx/     Reverse proxy وSSE/WebSocket
scripts/     التطوير وWebhook وإدارة أول Admin
tests/       اختبارات Python
docs/        المتطلبات والمعمارية والمخططات
```

PostgreSQL هو مصدر الحقيقة، Redis للطوابير والحالة القصيرة، وS3-compatible
للملفات. Adapters تعزل AI وGitHub والتخزين وقواعد البيانات الخارجية. العمليات
الطويلة لا تنفذ داخل طلب HTTP أو Telegram update.

## تشغيل محلي كامل

المتطلبات: Docker 24+ وDocker Compose v2.

```bash
cp .env.example .env
openssl rand -hex 32
openssl rand -base64 32 | tr '+/' '-_'
```

ضع القيم الناتجة في `APP_SECRET_KEY` و`ENCRYPTION_MASTER_KEY`، واستبدل جميع قيم
`CHANGE_ME` في `.env`. أنشئ `JWT_SECRET` مستقلاً بـ`openssl rand -hex 32`.
الوصول إلى الواجهة والمراقبة مقيّد بالمالك: عيّن `OWNER_EMAIL`، ثم ولّد hash من
طرفية موثوقة (الإدخال لا يظهر ولا يدخل command history). إن لم تكن تبعيات
Backend مثبتة على المضيف، استخدم بيئة مؤقتة:

```bash
python -m venv .venv-bootstrap
.venv-bootstrap/bin/pip install 'argon2-cffi>=23.1,<26'
.venv-bootstrap/bin/python scripts/hash-password.py
```

ضع الناتج كاملاً بين علامتي اقتباس مفردتين في `OWNER_PASSWORD_HASH` داخل Secret
Manager أو `.env` المحلي، ولا تضع كلمة المرور نفسها. ثم:

```bash
./scripts/dev.sh
# أو: docker compose up --build
```

يفتح المدخل الموحد على <http://localhost:8080>، وتعمل migrations تلقائياً قبل
API. للفحص:

```bash
docker compose ps
curl --fail http://localhost:8080/healthz
docker compose logs -f api worker
```

## تشغيل بدون Docker

شغّل PostgreSQL وRedis، واضبط `.env` بعناوينهما، ثم ثبّت Python 3.12 وNode
22.13+:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e "./apps/api[bot,worker,dev]" -e ./apps/bot -e ./apps/worker
(cd apps/api && alembic upgrade head)
uvicorn platform_api.main:app --reload
arq platform_worker.main.WorkerSettings
npm ci
npm run dev
```

شغّل كل خدمة طويلة في طرفية مستقلة.

## إعداد Telegram Webhook

اضبط `TELEGRAM_BOT_TOKEN` و`TELEGRAM_WEBHOOK_SECRET` وURL HTTPS الكامل في
`TELEGRAM_WEBHOOK_URL` (وينتهي افتراضياً بـ`/api/v1/telegram/webhook`). خدمة
API تسجل التحديث idempotently في PostgreSQL وتعيد سريعاً، ثم يستهلك Worker
التحديث ويمرره إلى handlers في `apps/bot`، ثم:

```bash
./scripts/setup-webhook.sh
# للحذف دون حذف pending updates:
./scripts/delete-webhook.sh
```

لا تستخدم Webhook HTTP عاماً. يمكن استخدام polling في Development فقط إذا كانت
خدمة البوت تدعمه:

```bash
python -m platform_bot.polling
```

تقرأ الخدمة `HTTPS_PROXY` تلقائياً عند وجود شبكة مقيدة. لا تحفظ
`TELEGRAM_BOT_TOKEN` داخل Git؛ ضعه في `.env` المحلي أو Secret Manager فقط.

## نسخة Sites الدائمة

نسخة Sites لا تطلب عنوان Backend من المتصفح ولا تستخدم CORS: الواجهة وواجهات
`/api/edge/*` تعملان من النطاق نفسه، والمصادقة تتم بواسطة هوية Sites. تُخزن
المحادثات والمزودات والمشروعات وسجل التدقيق في D1، وتُشفّر مفاتيح المزودات
بـAES-GCM باستخدام سر إنتاج لا يدخل المستودع.

مسار Telegram هو `/api/telegram/webhook` ويتحقق من
`X-Telegram-Bot-Api-Secret-Token` ويمنع تكرار `update_id`. يُدخل المالك التوكن
الجديد من شاشة «الإعدادات والتخزين»؛ يتحقق الخادم منه عبر `getMe`، ويسجل
Webhook تلقائياً، ثم يخزن التوكن والسر مشفرين من دون إعادتهما للمتصفح.

تُخزن الصور والملفات في R2 وبيانات ملكيتها ومرفقات الرسائل في D1. تدعم
المحادثة صور JPEG/PNG/WebP/GIF وملفات PDF والنصوص وMarkdown وCSV وJSON حتى
10MB للملف. الصور تُرسل للنماذج المتوافقة مع Vision كـdata URL، والملفات
النصية تدخل في سياق الطلب. تبقى FFmpeg وyt-dlp وSandbox داخل Worker حاويات
دائم لأن Edge runtime لا يشغّل هذه البرامج.

## إنشاء أول Admin

بعد تشغيل المنصة وضبط `OWNER_EMAIL` و`OWNER_PASSWORD_HASH`، هيّئ سجل المالك
بتسجيل دخول محلي. تقرأ الأداة كلمة المرور بلا echo ولا تضعها في command history:

```bash
./scripts/seed-admin.sh
# أو:
make seed-admin
```

يتحقق Backend من Argon2 hash وينشئ المستخدم بدور `superadmin` عند أول دخول. لا
تعدّل الجدول يدوياً ولا تمرر كلمة المرور كوسيط.

## إضافة مزود AI

من شاشة «مزودات الذكاء الاصطناعي»، أدخل الاسم وBase URL HTTPS ونوع التوافق
وAPI Key. ينفذ Backend اختبار اتصال، يخزن المفتاح مشفراً، ويحاول جلب النماذج.
إذا لم يدعم المزود listing يمكن تحديد `default_model` عبر الـAPI. واجهات
Ollama/LM Studio المحلية تتطلب تفعيل سماح الشبكات الخاصة إدارياً ولا يُسمح
بها في Production افتراضياً.

## GitHub (مرحلة التكامل التالية)

متغيرات `GITHUB_*` وWorkflow النشر موجودة، لكن OAuth/App وعمليات
branch/commit/PR داخل الوكيل ليست ضمن نواة الـMVP الحالية بعد. عند إضافتها يجب
استخدام GitHub App/OAuth بصلاحيات المستودعات المطلوبة فقط؛ لا تستخدم PAT عاماً
طويل العمر. يبقى push وPR والنشر خلف موافقة صريحة.

## الجودة

```bash
make lint
make typecheck
make test
make check
docker compose config --quiet
```

CI يفحص Ruff وmypy وpytest مع coverage، ESLint وTypeScript والبناء، audits
والأسرار وصور Docker. التغطية الحالية 62% للمسارات المنفذة، والبيانات
الاختبارية محصورة بالاختبارات.

بعد ربط GitHub Environment وVPS كما في دليل النشر، كل Push ناجح إلى `main`
يشغّل CI ثم يعيد بناء وتشغيل API وWorker (بما فيه handlers البوت) والويب تلقائياً. يبقى النشر معطلاً
افتراضياً حتى ضبط `ENABLE_VPS_DEPLOY=true` وأسرار SSH، ويمكن فرض موافقة بشرية
عبر حماية Environment.

## النشر والأمان

- [DEPLOYMENT.md](DEPLOYMENT.md): VPS، النشر التلقائي، النسخ والاستعادة.
- [SECURITY.md](SECURITY.md): الأسرار، الإبلاغ، والعمليات الحساسة.
- [API.md](API.md): اتفاقيات API والتشغيل.
- [CONTRIBUTING.md](CONTRIBUTING.md): مسار المساهمة.
- `docs/`: PRD والمعمارية وقاعدة البيانات وتدفقات الاستخدام.

الإعداد قابل للنقل إلى أي Container Host. لا تُعد مساحة التطوير استضافة دائمة،
ولا يتم أي نشر خارجي دون بيانات اعتماد وموافقة صريحة.
