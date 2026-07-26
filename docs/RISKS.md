# المخاطر والقرارات التقنية

## سجل المخاطر

| الخطر | الاحتمال/الأثر | المعالجة | الإشارة المبكرة |
|---|---|---|---|
| تسريب API keys | متوسط/حرج | AEAD، redaction، masking، secret scanning ودوران | ظهور header/credential في trace |
| SSRF من Base URL أو media URL | عالٍ/حرج | DNS/IP validation، منع private/metadata، HTTPS وredirect recheck | طلبات إلى IP داخلي |
| هروب Agent أو command injection | متوسط/حرج | container non-root، allowlisted argv، limits، no host socket | syscall/network غير مسموح |
| تكرار Webhook/Job | عالٍ/عالٍ | unique idempotency، locks، state machine | أثران لنفس المفتاح |
| فقدان مهام Redis | متوسط/عالٍ | PostgreSQL source of truth + reconciler/heartbeat | queued بلا ARQ id |
| كلفة AI غير مضبوطة | عالٍ/عالٍ | quotas، max tokens/steps/budget، cancel وusage | انحراف usage/cost |
| مخالفة حقوق الوسائط | متوسط/عالٍ | تنبيه وقيود، لا DRM/private/paywall، retention | مصادر محظورة متكررة |
| تغير APIs الخارجية | عالٍ/متوسط | adapters، contract tests، capability fallback | ارتفاع mapped unknown errors |
| موافقة على diff قديم | متوسط/عالٍ | operation hash + expiry وإبطال عند التغير | hash mismatch |
| امتلاء التخزين | متوسط/عالٍ | quotas، lifecycle، cleanup، metrics/alerts | retention lag أو disk pressure |
| كبر نطاق MVP | عالٍ/عالٍ | بوابات مراحل وAdapters محدودة فعلية | خصائص كثيرة بلا اختبارات |
| Vendor lock-in | منخفض/متوسط | S3-compatible وعقود مستقلة وصور OCI | اعتماد API سحابي داخل domain |

## قرارات معمارية مختصرة

### ADR-001: Modular Monolith

**قرار:** وحدات نطاق داخل API واحد مع Worker مستقل.  
**سبب:** معاملات أوضح وتشغيل أبسط، والحدود تسمح بالاستخراج لاحقاً.  
**رفضنا الآن:** Microservices لأنها تضيف اتساقاً موزعاً ومراقبة ونشر متعدد بلا حاجة مثبتة.

### ADR-002: ARQ + سجل PostgreSQL

**قرار:** ARQ لتنفيذ async وRedis broker، مع `background_jobs` كسجل دائم.  
**سبب:** انسجام مع Python async وبساطة أعلى من Celery.  
**قيد:** ميزات workflows المعقدة تبنى في Orchestrator؛ إن تجاوزت الحاجة ذلك يعاد تقييم Temporal/Dramatiq.

### ADR-003: SSE

**قرار:** SSE للبث والتقدم في MVP.  
**سبب:** أبسط خلف proxies وملائم للاتجاه من الخادم للعميل. الإلغاء HTTP مستقل.

### ADR-004: تشفير AEAD على مستوى التطبيق

**قرار:** مفتاح رئيسي من Secret Manager/env، مع versioning وتجهيز لدوران.  
**سبب:** لا يمكن لنسخة DB وحدها فك الأسرار. الإنتاج يفضل KMS envelope encryption عند توفره.

### ADR-005: S3-compatible

**قرار:** DB تحفظ metadata فقط والملفات في Object Storage.  
**سبب:** قابلية النقل، presigned URLs وlifecycle. لا تعتمد صلاحية المستخدم على معرفة storage key.

### ADR-006: GitHub App أولاً

**قرار:** GitHub App للمستودعات الإنتاجية، OAuth للدخول/الربط عند الحاجة.  
**سبب:** installation tokens قصيرة وصلاحيات/مستودعات محددة أفضل من PAT عام.

### ADR-007: Sandbox محلي بالحاويات

**قرار:** Docker/OCI container مؤقت لكل run، ولا يركب socket المضيف.  
**سبب:** عزل عملي لـMVP. في بيئات أعلى خطراً ينتقل إلى gVisor/Firecracker أو runners منفصلة.

## قرارات تحتاج مراجعة لاحقة

- تفعيل RLS بعد اكتمال transaction identity واختبارات pool leakage.
- دعم WebSocket إذا احتاج terminal تفاعلياً حقيقياً.
- نقل media/agent إلى طوابير أو workers منفصلة عند ظهور ضغط موارد فعلي.
- KMS provider حسب بيئة النشر، مع بقاء `SecretCipher` مستقلاً.

