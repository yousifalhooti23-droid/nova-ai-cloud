# ARCHITECTURE — البنية المعمارية

<div dir="rtl">

## نظرة عامة

```
┌─────────────────────────────────────────────────────────────────────┐
│  المتصفح                                                             │
│  React 18 + TypeScript + Tailwind + CodeMirror 6 + zustand          │
│  (عربي RTL / إنجليزي LTR — تبديل فوري)                              │
└───────────────┬─────────────────────────────────────────────────────┘
                │  fetch + SSE فقط عبر /api/*   (لا مفاتيح في الواجهة)
┌───────────────▼─────────────────────────────────────────────────────┐
│  Cloudflare Worker  —  Hono app (50 مساراً)                         │
│  ├── Model Router ──► Workers AI · OpenRouter · Custom · Diagnostic │
│  ├── Agent Loop (16 أداة، تفكيك مهام، موافقة قبل التطبيق)           │
│  ├── Storage: D1 (17 جدولاً) · R2 (ملفات/مرفقات) · JsonStore (Node) │
│  └── Sandbox adapter  ◄── **لا يُنفَّذ شيء هنا أبداً**              │
└───────────────┬─────────────────────────────────────────────────────┘
                │  service binding / HTTP
┌───────────────▼─────────────────────────────────────────────────────┐
│  Sandbox معزول:  worker (isolate بلا bindings)  أو  http (خارجي)     │
└─────────────────────────────────────────────────────────────────────┘
```

**18,056 سطراً** من TypeScript/TSX عبر 4 workspaces — بدون ملف واحد ضخم.

---

## طبقات الفصل

### 1. `packages/shared` — العقد الواحد

المصدر الوحيد للحقيقة بين الطرفين. لا يعرف شيئاً عن React ولا عن Workers.

| الملف | المسؤولية |
|---|---|
| `types.ts` | أنواع النطاق: `ModelInfo` · `ModelClass` · `ProviderStatus` · `FreeTier` · `ProviderId` |
| `api.ts` | عقود الطلب/الاستجابة لكل مسار + أحداث SSE |
| `sse.ts` | `createSseParser()` — محلّل واحد يُستخدم في الخادم **و** الواجهة **و** الاختبارات |
| `diff.ts` | حساب الفروقات وبناؤها للعرض (مشترك بين Diff View و Changes Panel) |
| `validation.ts` | تحقّق آمن من المدخلات (بدون مكتبات خارجية) |
| `lang.ts` | كشف اللغة والاتجاه (RTL/LTR) |
| `ids.ts` | توليد معرّفات مُسبَّقة النوع (`prj_` · `req_` · ...) |
| `catalog/` | كتالوج النماذج الموثَّق + `PROVIDER_META` |

> **قاعدة**: أي تغيير في العقد يحدث هنا أولاً — فيكتشف `tsc --strict` كل كسر فوراً
> في الطرفين.

### 2. `apps/worker` — الـ Backend

#### نقطة الدخول المزدوجة

```
src/index.ts   →  export default { fetch }        (Cloudflare Workers)
src/node.ts    →  createApp(bootstrap(...))        (Node، لتطوير محلي بلا wrangler)
src/app.ts     →  createApp(deps)  →  Hono instance (نفس الكود للطرفين)
```

نفس التطبيق يعمل على Workers وعلى Node — الفرق الوحيد هو طبقة التخزين
(`d1-store` مقابل `json-store`) وطبقة الملفات (`blob` R2 مقابل القرص).

#### حقن الاعتماديات

`bootstrap()` يبني كل الاعتماديات ويقبل حقن بدائل:

```ts
bootstrap({ sandbox: fakeAdapter, store: memoryStore, log: silentLogger })
```

هذا ما يجعل **37 اختبار وكيل + 32 اختبار API** تعمل بدون شبكة ولا D1 ولا sandbox حقيقي.

#### طبقة الـ AI

| الملف | الدور |
|---|---|
| `ai/router.ts` | **الموجه** — يحلّ الفئة → مزوّد → نموذج، ويطبّق سياسة الأولوية |
| `ai/registry.ts` | سجل المزوّدين وحالتهم (`ready` / `missing-key` / `needs-remote` / `disabled`) |
| `ai/providers/workers-ai.ts` | `env.AI.run` مع كشف «يحتاج remote» بدل التزييف |
| `ai/providers/openai-compatible.ts` | OpenRouter · Groq · Custom — بثّ، أدوات، وإصلاح JSON دفاعي |
| `ai/providers/diagnostic.ts` | الصَدى التشخيصي — كل مخرج يبدأ بتحذير صريح أنه ليس ردّ نموذج |

**مبدأ**: الـ Router هو النقطة الوحيدة التي تعرف أسماء المزوّدين. بقية التطبيق يطلب
«فئة» فقط (`chat` / `reasoning` / `coding` / `long-context`). إضافة مزوّد جديد =
ملف واحد في `providers/` + سطر في `registry.ts`.

#### طبقة الوكيل

```
agent/loop.ts        حلقة التنفيذ (حتى 30 خطوة، افتراضي 12)
  ├── prompts.ts     أوامر النظام
  ├── permissions.ts سياسة الأوامر + تصنيف خطورة الأدوات
  ├── tools/         files · git-tools · terminal · planning · memory
  └── git.ts         Git بمخازن مُعنوَنة بالمحتوى
```

**دورة واحدة من الحلقة**:

```
1. ابنِ السياق (ملفات المشروع + الذاكرة + المهام المعلّقة)
2. استدعِ النموذج عبر الـ Router  ←  بثّ text.delta / reasoning.delta
3. هل هناك استدعاء أدوات؟
     ├─ read-only      → نفّذ مباشرة
     ├─ proposal       → أنشئ تغييراً معلّقاً  → agent.await.approval
     └─ needs-approval → توقّف وانتظر إذن المستخدم
4. أغلق الحلقة عند: لا أدوات · موافقة مطلوبة · حدّ الخطوات · خطأ
```

عند بلوغ حدّ الخطوات يُحفظ التقدّم الجزئي وتُبلَّغ الرسالة:
> «Step limit reached (N). Partial progress was saved; ask me to continue…»

#### الموافقة قبل التطبيق

```
write_file / edit_file / delete_file
        ↓
   change (pending) في جدول changes
        ↓
   يظهر في Diff View + Changes Panel
        ↓
   POST /api/changes/:changeId  { action: "approve" | "reject" }
        ↓
   approve → يُكتب في project_files ويُخزَّن blob جديد
```

- `git_commit` **يرفض** التنفيذ ما دامت تغييرات معلّقة.
- `autoApply` اختياري (معطّل افتراضياً) — لتخطي الموافقة عمداً.
- `POST /api/projects/:id/changes/apply-all` يوافق على الدفعة كاملة.

#### Git بدون `git` binary

Workers لا يملك نظام ملفات، فبُني Git منطقي فوق D1:

```
project_blobs   ← مخازن مُعنوَنة بالمحتوى (content-addressed)
commits         ← سلسلة الآباء + رسالة + طابع زمني
project_files   ← مؤشر HEAD الحالي
```

يقدّم: سجل حقيقي · diff بين commitين · إحصاءات · استعادة إصدار سابق.
**GitHub push اختياري** (`GITHUB_TOKEN` + `GITHUB_REPO`) ويفشل برسالة صريحة عند عدم الإعداد.

### 3. `apps/web` — الواجهة

| الطبقة | المحتوى |
|---|---|
| `pages/` | `ChatPage` · `CodePage` |
| `components/chat/` | `Composer` · `MessageBubble` · `Markdown` · `Highlight` · `ModelPicker` |
| `components/code/` | `FileTree` · `EditorPane` · `DiffView` · `ChangesPanel` · `TasksPanel` · `TerminalPanel` · `SearchPanel` · `GitPanel` · `AgentPanel` |
| `components/layout/` | `Sidebar` (قابل للطي، متجاوب) |
| `components/settings/` | `SettingsModal` (اللغة، الاتجاه، الافتراضيات، المزوّدون) |
| `store/` | zustand: `app` (تفضيلات) · `chat` (بثّ) · `code` (مشاريع/وكيل/طرفية) |
| `i18n/` | `dictionary.ts` (635 سطراً، عربي + إنجليزي) |
| `lib/` | `api` · `sse` · `format` · `cn` |
| `hooks/` | `useMediaQuery` (طيّ السكك تلقائياً) · `useStickToBottom` |

#### إدارة الحالة

zustand مع **selectors مستقرة**:

```ts
// ❌ خطأ — مصفوفة جديدة كل استدعاء → حلقة useSyncExternalStore لا نهائية
const models = useChatStore((s) => s.models ?? []);

// ✅ صحيح — ثابت على مستوى الوحدة
const NO_MODELS: ModelInfo[] = [];
const models = useChatStore((s) => s.models ?? NO_MODELS);
```

#### المحرر

CodeMirror 6 حقيقي (ليس `textarea`): تلوين حسب اللغة، أرقام أسطر، وضع قراءة فقط،
و**تقرير التعديلات للأعلى** ليُنشئ الوكيل diff من تعديلاتك اليدوية أيضاً.

#### التدويل والاتجاه

```ts
const dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.dir = dir;   // يُضبط فوراً ويُحفظ في التفضيلات
```

لا اعتماد على CDN خارجي في وقت التشغيل — الخطوط نظامية، وكل الأصول محلية.

---

## التخزين

### D1 — 17 جدولاً

| الجدول | المحتوى |
|---|---|
| `conversations` · `messages` | المحادثات ورسائلها |
| `projects` · `project_files` | المشاريع وشجرة الملفات |
| `project_blobs` | مخازن Git المُعنوَنة بالمحتوى |
| `changes` | التغييرات المعلّقة/المطبقة/المرفوضة |
| `commits` | سجل Git |
| `tasks` | مهام الوكيل المفكَّكة وحالتها |
| `agent_runs` · `agent_events` | كل تشغيل وأحداثه (لإعادة العرض والتدقيق) |
| `memory` | ذاكرة المشاريع |
| `attachments` · `usage` · `settings` · `catalog_cache` | المرفقات، الاستهلاك، الإعدادات، كتالوج OpenRouter الحيّ |

> **معالجة الفرز**: صفوف بنفس الطابع الزمني تُرتَّب بـ `rowid` كفاصل تعادل
> (`SELECT rowid AS _rid`) — وإلا اختلف الترتيب بين التشغيلات.

### R2 — الملفات

المرفقات والملفات الكبيرة تُخزَّن في R2 (`FILES` binding) مع حدود حجم
(`NOVA_MAX_UPLOAD_BYTES`، افتراضي 8MB) ومسار آمن (`safePath`).

### JsonStore — وضع Node

`NOVA_RUNTIME=node` يستبدل D1/R2 بمخزن ملفات تحت `NOVA_DATA_DIR` (افتراضي `./.nova-data`)
بنفس الواجهة (`storage/types.ts`). لا كود تطبيقي يتغيّر.

---

## البثّ (SSE)

### أحداث المحادثة

| الحدث | المعنى |
|---|---|
| `message.start` | بدأ توليد الرد |
| `text.delta` | قطعة نص |
| `reasoning.delta` | قطعة تفكير (نماذج الاستدلال) |
| `title.generated` | عنوان المحادثة الجديد |
| `usage` | الرموز المستهلكة |
| `message.done` | اكتمل |
| `error` | خطأ مع `code` ورسالة قابلة للعرض |

### أحداث الوكيل

| الحدث | المعنى |
|---|---|
| `agent.start` | `runId` · النموذج · المزوّد · `maxSteps` |
| `agent.status` · `agent.thought` | تقدّم وتفكير الوكيل |
| `agent.tool.start` · `agent.tool.result` | استدعاء أداة ونتيجتها |
| `agent.await.approval` | توقّف بانتظار موافقتك |
| `agent.done` | اكتمل التشغيل |

> **تفصيلة حاسمة للاختبارات**: `createSseParser` يقرأ **فقط** سطر `data:` JSON ويتجاهل
> `event:`. لذلك يجب أن يكون `type` **داخل** الحمولة — وهذا ما يفعله `encodeEvent`
> في الخادم وما تفعله الـ mocks في اختبارات الواجهة.

---

## الأخطاء

```ts
HttpError { status, code, message, hint? }  →  JSON متسق
app.onError → describeError(err)            →  500 تُسجَّل، 4xx تُعاد كما هي
app.notFound → { error, code:'not_found', hint:'API routes live under /api/*' }
```

**لا يوجد خطأ صامت ولا نجاح مُختلَق.** أمثلة رموز: `provider_not_configured` ·
`command_blocked` · `sandbox_not_configured` · `needs-remote` · `validation_error`.

---

## الأمان

| المبدأ | التنفيذ |
|---|---|
| لا مفاتيح في الواجهة | الأسرار في `.dev.vars`/`.env` فقط؛ الواجهة تتكلم `/api/*` حصراً |
| لا تنفيذ على الخادم الرئيسي | Sandbox adapter — `disabled` افتراضياً (fail-closed) |
| CORS صارم | `NOVA_ALLOWED_ORIGINS` فارغ = نفس المصدر فقط؛ `OPTIONS` → 204 |
| تحقّق من المدخلات | `safeParseArgs` + `validation.ts` + `safePath` |
| حقن مفاتيح في الذاكرة | `NOVA_ALLOW_RUNTIME_KEYS` (معطّل افتراضياً) + `NOVA_ADMIN_TOKEN`؛ **لا تُخزَّن ولا تُعاد أبداً** |
| سياسة أوامر في طبقتين | أداة الوكيل **و** مسار `/api/sandbox/exec` |
| لا مزوّد مدفوع صامتاً | النماذج المدفوعة موثّقة `freeTier:'paid'` ولا تُختار تلقائياً |

---

## الاختبارات

```
tests/                     109 اختبار backend (Vitest، مشروع "backend")
  shared.test.ts    17     العقود، diff، SSE، validation، lang، ids
  router.test.ts    23     الأولوية، النماذج المقفلة، حجب agentic harness، الأخطاء الصريحة
  agent.test.ts     37     الحلقة، الأدوات، الموافقة، Git، التفكيك
  api.test.ts       32     المسارات (منها 6 لسياسة الـ Sandbox)

apps/web/src/__tests__/     12 اختبار واجهة (Vitest + jsdom، مشروع "web")
  app.test.tsx       9     تكامل مع mock API (SSE حقيقي الصيغة)
  editor.test.tsx    3     CodeMirror فعلياً — يعرض، يبلّغ، وضع قراءة
  setup.ts                 shims: matchMedia يقيّم min/max-width ضد innerWidth=1600؛
                           Range.getClientRects/getBoundingClientRect تُصفَّر
                           (قياسات CodeMirror غير موجودة في jsdom)
  mockApi.ts               إطار SSE يطابق encodeEvent (type داخل الحمولة)
```

**المجموع: 121 اختباراً ناجحاً** + `smoke` 26/26 + `sandbox:selftest` 10/10.

```bash
npm test                 # الكل (121)
npm run test:backend     # 109
npm run test:web         # 12
npm run typecheck        # tsc --strict على worker و web
```

---

## المنافذ

| المنفذ | الخدمة |
|---|---|
| **5173** | Vite dev (HMR) — يوكّل `/api` → 8787 |
| **8787** | Wrangler: API + أصول الإنتاج المبنية |
| **8788** | Sandbox Worker المعزول (`npm run dev:sandbox-worker`) |
| **8790** | الخادم المرجعي للـ Sandbox (`npm run dev:sandbox`) — ⚠️ بدون عزل |

---

## البناء والإنتاج

```bash
npm run build      # vite build → apps/web/dist
npm run deploy     # build ثم wrangler deploy (يقدَّم dist عبر assets binding)
```

حزمة الإنتاج (1902 وحدة):

| الأصل | الحجم | مضغوط (gzip) |
|---|---|---|
| `index.js` | 650.0 KB | 213.7 KB |
| `editor.js` (CodeMirror) | 290.2 KB | 95.5 KB |
| `markdown.js` | 172.4 KB | 52.5 KB |
| `index.css` | 42.9 KB | 8.4 KB |

تقسيم الأثقال (editor/markdown) منفصل حتى لا يدفع مستخدم المحادثة ثمن CodeMirror.

> ⚠️ **ملاحظة ذاكرة**: `vite build` يفشل (يُقتل esbuild) إذا كان `wrangler dev` وVite dev
> يعملان معاً تحت 1GB RAM. **أوقف الخوادم قبل البناء.** وVite يفرّغ `dist/` **قبل**
> البناء، فبناء فاشل يترك `GET /` → 404.

---

## مسار إضافة مزوّد جديد

1. `apps/worker/src/ai/providers/<name>.ts` — نفّذ واجهة المزوّد.
2. `ai/registry.ts` — سجّله مع `keyEnvVar` وطريقة كشف الحالة.
3. `packages/shared/src/types.ts` — أضف المعرّف إلى `ProviderId`.
4. `packages/shared/src/catalog/` — أضف النماذج مع `freeTier` · `access` · `pricing` · `verifiedAt`.
5. `.env.example` — وثّق المتغير الجديد.
6. اختبار في `tests/router.test.ts`.

**لا شيء آخر يتغيّر** — لا الواجهة، لا الوكيل، لا المسارات.

</div>

---

## English summary

Four npm workspaces, ~18k lines, one shared contract package:

- **`packages/shared`** — the single source of truth: domain types, API contracts, one SSE parser
  used by server + client + tests, diff computation, validation, language/RTL detection,
  and the **verified** model catalog with `PROVIDER_META` (free-tier facts, `requiresCard`, `verifiedAt`).
- **`apps/worker`** — a Hono app (50 routes) with **two entry points**: Cloudflare Workers
  (`src/index.ts`) and Node (`src/node.ts`), sharing `createApp(deps)`. All dependencies are
  injected via `bootstrap()`, which is why 69 backend tests run with no network, no D1, no sandbox.
  Layers: Model Router (the only code that knows provider names) → Agent loop (16 tools, max 30 steps,
  approval-before-apply, content-addressed Git over D1) → Storage (D1 17 tables / R2 / JsonStore).
- **`apps/web`** — React 18 + TS + Tailwind, real CodeMirror 6, zustand with stable selectors,
  Arabic RTL / English LTR, no external CDN at runtime. Code-split so chat users don't pay for the editor.
- **`sandbox/worker`** — a Worker with **zero bindings** for isolated JS execution.

Non-negotiables encoded in the architecture: no keys in the frontend; no execution in the API Worker;
no simulated model output (the router throws `ProviderNotConfiguredError` instead);
paid-only models catalogued as paid and never auto-selected; command policy enforced in two places.

Companion docs: [MODELS](MODELS.md) · [SANDBOX](SANDBOX.md) · [README](../README.md)
