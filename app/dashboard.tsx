"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type View = "chat" | "agent" | "media" | "providers" | "admin" | "settings";
type Notice = { tone: "ok" | "error" | "info"; text: string } | null;
type ChatMessage = { role: "user" | "assistant"; content: string };

const nav: Array<{ id: View; icon: string; label: string; hint: string }> = [
  { id: "chat", icon: "✦", label: "الدردشة الذكية", hint: "محادثة متعددة النماذج" },
  { id: "agent", icon: "⌘", label: "الوكيل البرمجي", hint: "مشاريع وخطط وتنفيذ" },
  { id: "media", icon: "▶", label: "الوسائط", hint: "تنزيل ومعالجة قانونية" },
  { id: "providers", icon: "◇", label: "المزودات", hint: "مفاتيح ونماذج" },
  { id: "admin", icon: "▦", label: "الإدارة", hint: "مؤشرات وتدقيق" },
  { id: "settings", icon: "⚙", label: "الإعدادات", hint: "الاتصال والواجهة" },
];

const internalApi = "";

async function request<T>(
  apiBase: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
    ...init,
    credentials: "include",
    signal: init?.signal || AbortSignal.timeout(6000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await response.json()) as T;
}

export default function Dashboard() {
  const [view, setView] = useState<View>("chat");
  const [mobileNav, setMobileNav] = useState(false);
  const apiBase = internalApi;
  const [online, setOnline] = useState<boolean | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const checkHealth = useCallback(async () => {
    try {
      await request(apiBase, "/api/edge/health");
      setOnline(true);
      try {
        await request(apiBase, "/api/edge/me");
        setAuthenticated(true);
      } catch {
        setAuthenticated(false);
      }
    } catch {
      setOnline(false);
      setAuthenticated(false);
    }
  }, [apiBase]);

  useEffect(() => {
    // Health and session state originate outside React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkHealth();
  }, [checkHealth]);

  const open = (next: View) => {
    setView(next);
    setMobileNav(false);
    setNotice(null);
  };

  if (!authenticated) {
    return (
      <Login online={online} checking={authenticated === null} />
    );
  }

  return (
    <main dir="rtl" className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">م</span>
          <div>
            <strong>مِداد AI</strong>
            <small>مساحة العمل الذكية</small>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => open(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span><b>{item.label}</b><small>{item.hint}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="usage"><span>الاستخدام الشهري</span><b>يُجلب من الخادم</b></div>
          <div className="meter"><i style={{ width: online ? "12%" : "0%" }} /></div>
          <p>لا تُعرض أرقام تقديرية قبل اتصال النظام.</p>
        </div>
      </aside>

      {mobileNav && <button className="scrim" aria-label="إغلاق القائمة" onClick={() => setMobileNav(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="فتح القائمة">☰</button>
          <div>
            <span className={`status-dot ${online ? "online" : online === false ? "offline" : ""}`} />
            <span>{online ? "الخدمات متصلة" : online === false ? "الخادم غير متصل" : "جارٍ التحقق"}</span>
          </div>
          <div className="top-actions">
            <button className="quiet-button" onClick={() => void checkHealth()}>تحديث الحالة</button>
            <button className="quiet-button" onClick={async () => {
              window.location.assign("/signout-with-chatgpt?return_to=/");
            }}>خروج</button>
            <span className="avatar">م</span>
          </div>
        </header>

        {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}

        <div className="content">
          {view === "chat" && <Chat apiBase={apiBase} online={online} setNotice={setNotice} />}
          {view === "agent" && <Agent apiBase={apiBase} setNotice={setNotice} />}
          {view === "media" && <Media apiBase={apiBase} setNotice={setNotice} />}
          {view === "providers" && <Providers apiBase={apiBase} setNotice={setNotice} />}
          {view === "admin" && <Admin apiBase={apiBase} online={online} setNotice={setNotice} />}
          {view === "settings" && <Settings />}
        </div>
      </section>
    </main>
  );
}

function SectionHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>
      {action}
    </div>
  );
}

function Chat({ apiBase, online, setNotice }: { apiBase: string; online: boolean | null; setNotice: (n: Notice) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    setMessages((items) => [...items, { role: "user", content }]);
    setInput("");
    setBusy(true);
    try {
      let id = conversationId;
      if (!id) {
        const conversation = await request<{ id: string }>(apiBase, "/api/edge/conversations", {
          method: "POST", body: JSON.stringify({ title: content.slice(0, 70) }),
        });
        id = conversation.id;
        setConversationId(id);
      }
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/edge/conversations/${id}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error(await response.text());
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/event-stream") && response.body) {
        setMessages((items) => [...items, { role: "assistant", content: "" }]);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aggregate = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as { delta?: string };
              aggregate += parsed.delta || "";
            } catch { aggregate += data; }
          }
          setMessages((items) => [...items.slice(0, -1), { role: "assistant", content: aggregate }]);
        }
      } else {
        const result = (await response.json()) as { content: string };
        setMessages((items) => [...items, { role: "assistant", content: result.content }]);
      }
    } catch (error) {
      setNotice({ tone: "error", text: `تعذر إرسال الرسالة: ${error instanceof Error ? error.message : "خطأ غير معروف"}` });
    } finally { setBusy(false); }
  }

  return (
    <div className="chat-layout">
      <section className="chat-panel">
        <SectionHeading
          eyebrow="محادثة جديدة"
          title="اسأل، ابنِ، وراجع في مكان واحد"
          copy="يُحفظ السياق في الخادم وتصل الإجابة لحظياً من المزود الذي أعددته."
          action={<button className="secondary-button" onClick={() => { setMessages([]); setConversationId(null); }}>محادثة جديدة ＋</button>}
        />
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="spark">✦</div>
              <h2>ما الذي تريد إنجازه اليوم؟</h2>
              <p>{online ? "الخادم جاهز. اختر مزوداً ثم ابدأ." : "اربط الخادم من الإعدادات، ثم أضف مزود ذكاء اصطناعي."}</p>
              <div className="suggestions">
                {["خطّط API آمنة لمشروعي", "راجع هذا التصميم معمارياً", "حوّل المتطلبات إلى خطوات"].map((text) => (
                  <button key={text} onClick={() => setInput(text)}>{text}<span>←</span></button>
                ))}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <article key={index} className={`message ${message.role}`}>
              <b>{message.role === "user" ? "أنت" : "المساعد"}</b>
              <p>{message.content || "…"}</p>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={send}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="اكتب رسالتك… (Enter للإرسال)" onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          }} />
          <div><span>النموذج الافتراضي من إعدادات المزود</span><button disabled={busy || !input.trim()}>{busy ? "جارٍ التوليد…" : "إرسال ↑"}</button></div>
        </form>
      </section>
      <aside className="context-panel">
        <h3>سياق المحادثة</h3>
        <dl><div><dt>الحالة</dt><dd>{conversationId ? "محفوظة" : "جديدة"}</dd></div><div><dt>Streaming</dt><dd>مفعّل</dd></div><div><dt>الرسائل</dt><dd>{messages.length}</dd></div></dl>
        <div className="security-note"><b>خصوصية المفاتيح</b><p>فك التشفير يحدث داخل الخادم وقت الطلب فقط، ولا تصل المفاتيح إلى المتصفح.</p></div>
      </aside>
    </div>
  );
}

function Login({ online, checking }: {
  online: boolean | null;
  checking: boolean;
}) {
  return (
    <main dir="rtl" className="login-page">
      <section className="login-brand">
        <span className="brand-mark">م</span>
        <p>مِداد AI</p>
        <h1>منصة واحدة لبناء الأفكار وتشغيلها بأمان.</h1>
        <ul>
          <li><i>✦</i><span><b>ذكاء متعدد المزودات</b><small>مفاتيح مشفرة وبث لحظي للمحادثات</small></span></li>
          <li><i>⌘</i><span><b>وكيل برمجي مضبوط</b><small>Sandbox وموافقات قبل العمليات الحساسة</small></span></li>
          <li><i>▦</i><span><b>مراقبة من مصدر الحقيقة</b><small>مؤشرات حقيقية وسجل تدقيق شامل</small></span></li>
        </ul>
      </section>
      <section className="login-panel">
        <div className="site-login-card">
          <div className="login-lock">⌁</div>
          <span className={`login-status ${online ? "ready" : ""}`}>{checking ? "جارٍ التحقق من الجلسة" : online ? "Edge API متصل" : "يلزم تسجيل الدخول"}</span>
          <h2>دخول المالك</h2>
          <p>المصادقة تتم عبر Sites، ولا تُرسل كلمة مرور المالك إلى JavaScript أو إلى Backend خارجي.</p>
          <a className="primary-button" href="/signin-with-chatgpt?return_to=/">دخول آمن عبر المنصة</a>
          <small className="login-foot">الوصول مقيّد بقائمة مستخدمي الموقع، وتُسجل العمليات الحساسة في قاعدة البيانات.</small>
        </div>
      </section>
    </main>
  );
}

function Providers({ apiBase, setNotice }: { apiBase: string; setNotice: (n: Notice) => void }) {
  const [form, setForm] = useState({ name: "", base_url: "https://api.openai.com/v1", api_key: "", compatibility: "openai" });
  const [providers, setProviders] = useState<Array<{ id: string; name: string; base_url: string; key_hint?: string }>>([]);
  const load = useCallback(async () => {
    try { setProviders(await request(apiBase, "/api/edge/providers")); } catch { setProviders([]); }
  }, [apiBase]);
  // Provider records are owned by the API rather than component state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await request(apiBase, "/api/edge/providers", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, name: "", api_key: "" }); await load();
      setNotice({ tone: "ok", text: "حُفظ المزود ومفتاحه مشفراً." });
    } catch (error) { setNotice({ tone: "error", text: `تعذر حفظ المزود: ${String(error)}` }); }
  }
  async function test(id: string) {
    try {
      const result = await request<{ ok: boolean; models_count?: number }>(apiBase, `/api/edge/providers/${id}/test`, { method: "POST" });
      setNotice({ tone: result.ok ? "ok" : "error", text: result.ok ? `نجح الاتصال${result.models_count !== undefined ? ` — ${result.models_count} نموذجاً` : ""}.` : "فشل اختبار المزود." });
    } catch (error) { setNotice({ tone: "error", text: `فشل الاختبار: ${String(error)}` }); }
  }
  return (
    <>
      <SectionHeading eyebrow="التكاملات" title="مزودات الذكاء الاصطناعي" copy="أضف أي واجهة OpenAI-compatible. يتحقق الخادم من العنوان ويشفّر المفتاح قبل التخزين." />
      <div className="two-column">
        <form className="card form-card" onSubmit={submit}>
          <h2>إضافة مزود</h2>
          <label>الاسم<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI / OpenRouter / خادم خاص" /></label>
          <label>Base URL<input required dir="ltr" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></label>
          <label>API Key<input required type="password" dir="ltr" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-••••••••" /></label>
          <label>نوع التوافق<select value={form.compatibility} onChange={(e) => setForm({ ...form, compatibility: e.target.value })}><option value="openai">OpenAI-compatible (يشمل OpenAI وOpenRouter وGroq وغيرها)</option></select></label>
          <button className="primary-button">حفظ المزود بأمان</button>
        </form>
        <section className="card">
          <h2>المزودات المحفوظة</h2>
          <div className="provider-list">
            {providers.length === 0 ? <p className="muted">لا توجد مزودات محفوظة في الخادم.</p> : providers.map((provider) => (
              <article key={provider.id}><div><b>{provider.name}</b><small dir="ltr">{provider.base_url}</small><em>{provider.key_hint || "مفتاح مخفي"}</em></div><button onClick={() => void test(provider.id)}>اختبار وجلب النماذج</button></article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Media({ apiBase, setNotice }: { apiBase: string; setNotice: (n: Notice) => void }) {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<{ title: string; duration?: number; formats?: Array<{ id: string; label: string }> } | null>(null);
  const [format, setFormat] = useState("");
  const [job, setJob] = useState<{ id: string; status: string; progress: number } | null>(null);
  async function analyze(event: FormEvent) {
    event.preventDefault();
    try {
      const queued = await request<{ id: string }>(apiBase, "/api/edge/media/analyze", { method: "POST", body: JSON.stringify({ url }) });
      setNotice({ tone: "info", text: "بدأ تحليل المصدر. ستظهر الصيغ عند اكتماله." });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = await request<{ status: string; result?: typeof analysis; error_code?: string }>(apiBase, `/api/edge/jobs/${queued.id}`);
        if (job.status === "completed" && job.result) {
          setAnalysis(job.result);
          setFormat("mp4");
          setNotice({ tone: "ok", text: "اكتمل التحليل وجُلبت الصيغ الفعلية." });
          return;
        }
        if (job.status === "failed") throw new Error(job.error_code || "فشل التحليل");
      }
      throw new Error("استغرق التحليل وقتاً أطول من المتوقع؛ راجع سجل المهام.");
    } catch (error) { setNotice({ tone: "error", text: `تعذر تحليل الرابط: ${String(error)}` }); }
  }
  async function createJob() {
    try {
      const job = await request<{ id: string }>(apiBase, "/api/edge/media/jobs", { method: "POST", body: JSON.stringify({
        url,
        mode: "video",
        format: ["mp4", "webm", "mp3", "m4a", "wav", "ogg"].includes(format) ? format : "mp4",
        quality: format,
        idempotency_key: crypto.randomUUID(),
      }) });
      setJob({ id: job.id, status: "queued", progress: 0 });
      setNotice({ tone: "ok", text: `أُضيفت المهمة إلى الطابور: ${job.id}` });
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const state = await request<{ id: string; status: string; progress: number }>(apiBase, `/api/edge/jobs/${job.id}`);
        setJob(state);
        if (["completed", "failed", "cancelled"].includes(state.status)) return;
      }
    } catch (error) { setNotice({ tone: "error", text: `تعذر إنشاء المهمة: ${String(error)}` }); }
  }
  async function cancelJob() {
    if (!job) return;
    const state = await request<{ id: string; status: string; progress: number }>(apiBase, `/api/edge/jobs/${job.id}/cancel`, { method: "POST" });
    setJob(state);
  }
  return (
    <>
      <SectionHeading eyebrow="معالجة معزولة" title="الفيديو والصوت" copy="حلّل المصادر المدعومة قانونياً، ثم اختر الصيغة والجودة قبل إرسال المهمة إلى Worker." />
      <form className="url-bar" onSubmit={analyze}><input dir="ltr" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/video" /><button>تحليل الرابط</button></form>
      <div className="card legal"><b>تنبيه الاستخدام المسؤول</b><p>استخدم الأداة فقط للمحتوى الذي تملك حق تنزيله ومعالجته. لا يدعم النظام DRM أو المحتوى الخاص أو المدفوع.</p></div>
      {analysis && <section className="card media-result"><div className="media-thumb">▶</div><div><span>تم التحليل</span><h2>{analysis.title}</h2><p>{analysis.duration ? `${Math.round(analysis.duration / 60)} دقيقة` : "المدة غير متاحة"}</p><label>الجودة المتاحة<select value={format} onChange={(e) => setFormat(e.target.value)}><option value="mp4">أفضل فيديو MP4</option>{analysis.formats?.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button className="primary-button" onClick={() => void createJob()}>بدء المعالجة</button></div></section>}
      {job && <section className="card job-progress"><div><b>حالة المهمة: {job.status}</b><span>{job.progress}%</span></div><div className="meter"><i style={{ width: `${job.progress}%` }} /></div>{job.status === "completed" ? <a className="primary-button" href={`${apiBase.replace(/\/$/, "")}/api/edge/jobs/${job.id}/download`}>تنزيل النتيجة</a> : !["failed", "cancelled"].includes(job.status) ? <button className="secondary-button" onClick={() => void cancelJob()}>إلغاء المهمة</button> : null}</section>}
    </>
  );
}

function Agent({ apiBase, setNotice }: { apiBase: string; setNotice: (n: Notice) => void }) {
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const project = await request<{ id: string }>(apiBase, "/api/edge/agent/projects", { method: "POST", body: JSON.stringify({ name }) });
      setProjectId(project.id); setNotice({ tone: "ok", text: "أُنشئ المشروع بمساحة عمل معزولة." });
    } catch (error) { setNotice({ tone: "error", text: `تعذر إنشاء المشروع: ${String(error)}` }); }
  }
  async function run() {
    if (!projectId) return;
    try {
      const result = await request<{ id: string; status: string }>(apiBase, `/api/edge/agent/projects/${projectId}/runs`, { method: "POST", body: JSON.stringify({ instruction }) });
      setNotice({ tone: "info", text: `بدأ التشغيل ${result.id} بحالة ${result.status}. العمليات الحساسة ستنتظر موافقة صريحة.` });
    } catch (error) { setNotice({ tone: "error", text: `تعذر بدء الوكيل: ${String(error)}` }); }
  }
  return (
    <>
      <SectionHeading eyebrow="تنفيذ مضبوط" title="مساحة الوكيل البرمجي" copy="خطة قابلة للاستكمال، أدوات بصلاحيات دقيقة، وموافقات قبل Git push أو النشر أو التغييرات المدمرة." />
      <div className="agent-grid">
        <form className="card form-card" onSubmit={create}><h2>مشروع جديد</h2><label>اسم المشروع<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="my-service" /></label><button className="primary-button">إنشاء Workspace</button></form>
        <section className="card run-card"><h2>تعليمة التشغيل</h2><textarea disabled={!projectId} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={projectId ? "أنشئ API واكتب الاختبارات…" : "أنشئ مشروعاً أولاً"} /><button className="primary-button" disabled={!projectId || !instruction.trim()} onClick={() => void run()}>إنشاء الخطة وبدء التنفيذ</button></section>
        <section className="card permissions"><h2>سياسة الأدوات</h2>{["قراءة وكتابة الملفات داخل Workspace", "تشغيل اختبارات بأوقات وموارد محددة", "Git commit محلي", "Push / PR بعد الموافقة فقط"].map((x, i) => <div key={x}><span className={i === 3 ? "approval" : "allowed"}>{i === 3 ? "يتطلب موافقة" : "مسموح"}</span><p>{x}</p></div>)}</section>
      </div>
    </>
  );
}

function Admin({ apiBase, online, setNotice }: { apiBase: string; online: boolean | null; setNotice: (n: Notice) => void }) {
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const load = useCallback(async () => {
    try { setMetrics(await request(apiBase, "/api/edge/admin/metrics")); }
    catch (error) { setMetrics(null); if (online) setNotice({ tone: "error", text: `تعذر تحميل المؤشرات: ${String(error)}` }); }
  }, [apiBase, online, setNotice]);
  // Metrics are fetched from the live system of record.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const cards = useMemo(() => [
    ["المستخدمون", metrics?.users],
    ["المحادثات", metrics?.conversations],
    ["كل المهام", metrics?.jobs],
    ["المهام الفاشلة", metrics?.failed_jobs],
  ], [metrics]);
  return (
    <>
      <SectionHeading eyebrow="بيانات حقيقية" title="لوحة الإدارة" copy="تظهر القيم فقط عند توفرها من قاعدة البيانات؛ لا تستخدم الواجهة أرقاماً تجريبية." action={<button className="secondary-button" onClick={() => void load()}>تحديث</button>} />
      <div className="metric-grid">{cards.map(([label, value]) => <article className="metric-card" key={String(label)}><span>{label}</span><b>{value ?? "—"}</b><small>{metrics ? "من الخادم الآن" : "بانتظار الاتصال"}</small></article>)}</div>
      <div className="two-column admin-bottom"><section className="card"><h2>صحة المكونات</h2>{["API", "PostgreSQL", "Redis", "Worker", "Telegram Webhook"].map((item, index) => <div className="health-row" key={item}><span>{item}</span><b className={online && index === 0 ? "healthy" : ""}>{online && index === 0 ? "متصل" : "غير متحقق"}</b></div>)}</section><section className="card"><h2>التدقيق والأمان</h2><p className="muted">يعرض هذا القسم أحدث سجلات التدقيق بعد تسجيل الدخول بصلاحية admin. لا تُرسل الواجهة أي بيانات سرية إلى خدمات قياس خارجية.</p><button className="secondary-button" onClick={() => setNotice({ tone: "info", text: "يتطلب هذا المسار جلسة Admin صالحة من الـBackend." })}>طلب سجل التدقيق</button></section></div>
    </>
  );
}

function Settings() {
  return (
    <>
      <SectionHeading eyebrow="تهيئة البيئة" title="الإعدادات" copy="الواجهة وEdge API يعملان الآن من النطاق نفسه، لذلك لا يلزم عنوان Backend أو إعداد CORS في المتصفح." />
      <section className="card settings-card"><div className="security-note"><b>اتصال Same-Origin</b><p>المصادقة وقاعدة البيانات وواجهات المزودات تعمل داخل Sites. وظائف FFmpeg وSandbox ستتصل لاحقاً بWorker حاويات مخصص عبر قناة خادم آمنة.</p></div></section>
    </>
  );
}
