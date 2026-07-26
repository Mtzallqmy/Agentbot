# النشر

## VPS عبر Docker Compose

المتطلبات: Docker Engine مع Compose v2، نطاق، وشهادة TLS عند Reverse Proxy خارجي.

```bash
git clone <repository-url> ai-agent-platform
cd ai-agent-platform
cp .env.example .env
openssl rand -hex 32
openssl rand -base64 32 | tr '+/' '-_'
# ضع القيم الناتجة وبقية الإعدادات في .env
python -m venv .venv-bootstrap
.venv-bootstrap/bin/pip install 'argon2-cffi>=23.1,<26'
.venv-bootstrap/bin/python scripts/hash-password.py
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
```

ولّد قيمة مستقلة لـ`JWT_SECRET`، واضبط `OWNER_EMAIL` و`OWNER_PASSWORD_HASH`
الناتج من الأداة. خزّن هذه القيم في Secret Manager أو ملف `.env` بصلاحية `0600`
على الخادم؛ لا تخزن بريد المالك أو كلمة مروره أو hash الخاص به في Git. غيّر
الأسرار عند الاشتباه بالتسريب، وإعادة إنشاء `JWT_SECRET` تسجل خروج الجلسات الحالية.
اضبط `AUTH_COOKIE_SECURE=true` في Production؛ يرفض التطبيق البدء بدونه.

لا تعرّض PostgreSQL أو Redis أو MinIO مباشرة للإنترنت. إعداد Nginx المرفق يستمع
HTTP داخلياً؛ أنهِ TLS في Caddy/Traefik/load balancer أو أضف شهادة Nginx مُدارة.

## النشر التلقائي من GitHub

Workflow النشر يعمل بعد نجاح `CI` على `main`، ولا يتفعّل إلا بعد:

1. إنشاء GitHub Environment باسم `production` وإضافة required reviewers.
2. ضبط Repository Variable: `ENABLE_VPS_DEPLOY=true`.
3. إضافة Environment Secrets:
   `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
   `DEPLOY_APP_PATH`.
4. تجهيز Clone للمستودع وملف `.env` على الخادم داخل `DEPLOY_APP_PATH`.

الحساب البعيد يحتاج صلاحيات محدودة على مجلد التطبيق وDocker فقط. يحتفظ Workflow
بالبيانات في volumes، ويشغّل migration service قبل API. خذ نسخة PostgreSQL وObject
Storage قبل migrations غير العكسية.

## النسخ والاستعادة

نسخة PostgreSQL:

```bash
docker compose exec -T postgres pg_dump -U ai_platform -Fc ai_platform > backup.dump
```

استعادة إلى قاعدة فارغة بعد إيقاف الخدمات الكتابية:

```bash
docker compose exec -T postgres pg_restore -U ai_platform -d ai_platform --clean --if-exists < backup.dump
```

انسخ volume الكائنات بسياسة أداة التخزين المستخدمة. اختبر الاستعادة دورياً في
بيئة منفصلة. لتراجع إصدار التطبيق، checkout للـSHA السابق ثم
`docker compose up -d --build`؛ تراجع قاعدة البيانات يعتمد على migration المحددة.

## منصات الحاويات

يمكن فصل صور `backend.Dockerfile` و`web.Dockerfile` على Railway/Render/Fly/Cloud
Run أو Kubernetes، مع PostgreSQL وRedis وS3 مُدارة. استبدل Nginx بمدخل المنصة،
وشغّل `alembic upgrade head` كـrelease job واحد قبل توسيع API/Worker.
