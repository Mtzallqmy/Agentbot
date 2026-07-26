# تدفقات الاستخدام

## 1. إضافة مزود وبدء محادثة

```mermaid
sequenceDiagram
    actor U as المستخدم
    participant W as Web/Telegram
    participant A as API
    participant P as Provider Adapter
    participant D as PostgreSQL
    U->>W: بيانات المزود
    W->>A: حفظ واختبار
    A->>A: تحقق URL + تشفير المفتاح
    A->>P: test/list models
    P-->>A: نماذج وقدرات
    A->>D: credential مشفر + models
    A-->>W: نتيجة منقحة
    U->>W: رسالة
    W->>A: إنشاء generation
    A->>D: حفظ user message
    A->>P: stream_chat
    P-->>A: chunks
    A-->>W: SSE chunks
    A->>D: حفظ الرد والاستخدام
```

إن فشل listing يسمح بإدخال model id يدوياً. الإلغاء يوقف stream قدر الإمكان ويثبت الرسالة `cancelled` دون ادعاء توقف فاتورة المزود فوراً.

## 2. Telegram Webhook

```mermaid
flowchart TD
    T["Telegram POST"] --> V{"Secret + schema صالحان؟"}
    V -- لا --> X["رفض منقح"]
    V -- نعم --> I{"update_id موجود؟"}
    I -- نعم --> OK["200 بلا تكرار"]
    I -- لا --> Q["تسجيل + enqueue الثقيل"]
    Q --> OK
    Q --> H["Handler / Worker"]
    H --> R["تحديث رسالة تقدم واحدة"]
```

التحديثات الخفيفة تعالج بسرعة، والثقيلة تسجل كمهام. callback data يحمل معرفاً قصيراً وتوقيعاً، لا أسراراً.

## 3. تنزيل ومعالجة وسائط

```mermaid
flowchart TD
    U["رابط المستخدم"] --> A["تحقق URL وسياسة الاستخدام"]
    A --> M["yt-dlp metadata فقط"]
    M --> C["اختيار صيغة/قص/تقسيم"]
    C --> J["Job دائم + ARQ"]
    J --> S["Sandbox download"]
    S --> F["FFmpeg limits"]
    F --> O["S3 + checksum"]
    O --> D{"ضمن حد Telegram؟"}
    D -- نعم --> T["إرسال الملف"]
    D -- لا --> P["رابط مؤقت موقّع"]
```

كل مرحلة تفحص الإلغاء والحصة. الملفات المؤقتة تحذف في `finally`، والمخرجات وفق retention. لا DRM ولا محتوى خاص أو مدفوع.

## 4. تشغيل وكيل وموافقة حساسة

```mermaid
sequenceDiagram
    actor U as المستخدم
    participant O as Orchestrator
    participant S as Sandbox
    participant G as GitHub Adapter
    participant D as Database/Audit
    U->>O: هدف + صلاحيات
    O->>D: run + plan
    O->>S: create isolated workspace
    loop حتى الحد
        O->>S: أداة مسموحة
        S-->>O: نتيجة قابلة للتحقق
        O->>D: step + tool call
    end
    O-->>U: diff + commands + impact
    U->>O: موافقة
    O->>D: verify operation hash
    O->>G: branch/push/PR
    G-->>O: references
    O->>D: audit + completed
```

أي تغير في diff أو الهدف يبطل الموافقة. الرفض يبقي workspace والنتائج حسب retention، ولا ينفذ الأثر الخارجي.

## 5. الإدارة والحصص

Admin endpoints تجمع من جداول الاستخدام والمهام والتدقيق، ومن Prometheus للصحة التشغيلية. الحظر أو تعديل الحصة عملية مدققة. إعادة المحاولة تنشئ attempt جديداً مرتبطاً بالأصل مع idempotency مستقل؛ لا يعاد تنفيذ أثر خارجي مكتمل.

## 6. الدخول للويب

Telegram Login/WebApp `initData` يتحقق بتوقيع Telegram وتاريخ المصادقة قبل إنشاء session. يصدر access JWT قصير في الذاكرة وrefresh token عشوائي كـHttpOnly Secure SameSite cookie، ولا يخزن refresh raw بل hash. GitHub OAuth منفصل عن جلسة المنصة ويستخدم state + PKCE حيث ينطبق.

