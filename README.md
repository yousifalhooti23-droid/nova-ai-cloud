# NOVA AI Cloud

> منصة ذكاء اصطناعي سحابية شخصية تعمل بالكامل في المتصفح — تجمع بين محادثة ذكية (ChatGPT/Kimi)
> وبيئة تطوير وكيلية (Claude Code / Codex) فوق بنية Cloudflare Workers المجانية.
>
> *A personal cloud AI platform that runs entirely in the browser — conversational AI (ChatGPT/Kimi)
> plus an agentic coding environment (Claude Code / Codex) — built on Cloudflare's free-tier Workers stack.*

<div dir="rtl">

## جدول المحتويات

1. [ما هي NOVA؟](#ما-هي-nova)
2. [الحالة الحالية — ما يعمل فعلاً](#الحالة-الحقيقية)
3. [المميزات](#المميزات)
4. [التشغيل السريع](#التشغيل-السريع)
5. [الإعدادات ومتغيرات البيئة](#الإعدادات)
6. [البنية المعمارية](#البنية-المعمارية)
7. [الموجه الذكي والنماذج](#النماذج)
8. [السandbox — تنفيذ الأوامر بأمان](#الـsandbox)
9. [الاختبارات](#الاختبارات)
10. [النشر](#النشر)
11. [الحدود المعروفة والأمانة](#الحدود-المعروفة)
12. [English summary](#english-summary)

</div>

---

<div dir="rtl">

## ما هي NOVA؟

NOVA هي تطبيق واحد يجمع ثلاثة أدوار:

| الدور | الوصف |
|---|---|
| **محادثة ذكية** | واجهة محادثة احترافية مع بثّ مباشر (streaming)، اختيار النموذج، حفظ المحادثات، رفع ملفات، نسخ الشيفرة، وذاكرة لكل مشروع. |
| **بيئة تطوير** | إنشاء وإدارة مشاريع، متصفح ملفات، محرر شيفرة حقيقي (CodeMirror)، بحث داخل المشروع، لوحة طرفية، ولوحة Git. |
| **وكيل برمجي** | وكيل (agent) يفهم الشيفرة، يقسّم المهام المعقدة، يعدّل الملفات، ويظهر كل تعديل في **Diff** ينتظر موافقتك قبل التطبيق. |

كل شيء يعمل على **Cloudflare Workers + D1 + R2** — لا خادم خاص، ولا تشغيل نماذج محلياً،
ولا اشتراكات مدفوعة مفعّلة تلقائياً.

---

## الحالة الحقيقية

هذه ليست وثيقة طموحات. هذا ما تم بناؤه واختباره فعلاً:

| العنصر | الحالة |
|---|---|
| اختبارات Backend | **109 ناجحة** (shared 17 · router 23 · agent 37 · api 32) |
| اختبارات الواجهة | **12 ناجحة** (9 تكاملية + 3 لمحرر CodeMirror حقيقي) |
| `npm run smoke` | **26/26** على خادم حي |
| `npm run sandbox:selftest` | **10/10** |
| تكامل الـ Sandbox الخارجي | **مُتحقَّق منه طرفاً لطرف** (`NOVA_SANDBOX=http`) |
| بناء الإنتاج (`vite build`) | **ناجح** — 1902 وحدة، ويقدَّم عبر Workers |
| فحص الأنواع (`tsc --strict`) | **نظيف** في worker و web |
| مسارات API | **50 مساراً** |
| أدوات الوكيل | **16 أداة** |
| جداول قاعدة البيانات | **17 جدولاً** |
| النماذج في الكتالوج | **39 نموذجاً** (موثّقة بتاريخ 2026-10-30) |

### ما **لا** يعمل (بصراحة)

- **`env.AI.run` لا يعمل في `wrangler dev` المحلي** — يتطلب `--remote` مع تسجيل دخول Cloudflare.
  الموجه لا يزيّف النتيجة: يُعيد حالة `needs-remote` ويشرح السبب.
- **لا يوجد نموذج يعمل مجاناً بدون أي مفتاح** — انظر [الحدود المعروفة](#الحدود-المعروفة).
- **وضع `worker` في الـ Sandbox ينفّذ JavaScript فقط** (بدون نظام ملفات أو شبكة) — انظر [docs/SANDBOX.md](docs/SANDBOX.md).

</div>

---

<div dir="rtl">

## المميزات

### 1. المحادثة الذكية

- بثّ تدريجي عبر **SSE** مع مؤشرات حالة (تفكير، استدعاء أدوات، أخطاء).
- **اختيار النموذج** من قائمة مجمّعة حسب الفئة (محادثة / استدلال / برمجة / سياق طويل).
- **حفظ المحادثات** في D1 مع ترقيم صفحات، وإعادة تسمية، وحذف.
- **رفع ملفات** (صور ونصوص) إلى R2 مع حدّ حجم قابل للضبط.
- **نسخ الشيفرة** بضغطة واحدة + تلوين syntax.
- **ذاكرة لكل مشروع** (`memory`) يقرأها الوكيل ويكتبها — سياق دائم بين الجلسات.
- دعم **Markdown** كامل مع جداول وقوائم وروابط.

### 2. بيئة التطوير

- إنشاء / إعادة تسمية / حذف مشاريع.
- **متصفح ملفات** شجري مع أيقونات حسب النوع.
- **محرر CodeMirror 6** حقيقي (ليس `textarea`) مع تلوين، أرقام أسطر، ووضع قراءة فقط.
- **بحث في المشروع** (نص + اسم ملف) مع نتائج وسياق.
- **لوحة طرفية** — معطّلة افتراضياً وتتطلب إذناً صريحاً لكل تشغيل.
- **لوحة Git**: حالة، سجل commits، diff، واستعادة إصدار سابق.

### 3. الوكيل البرمجي

- **تفكيك المهام**: المهام المعقدة تُقسَّم إلى خطوات مرئية قابلة للتتبع والتعديل.
- **مراجعة الأخطاء وإصلاحها**: `verify_code` يشغّل الفحص داخل الـ Sandbox ويعيد الأخطاء للوكيل ليصلحها.
- **الموافقة قبل التطبيق**: كل `write_file` / `edit_file` / `delete_file` ينتج **تغييراً معلّقاً** يظهر في Diff.
  لا شيء يُكتب على القرص قبل موافقتك. و`git_commit` يرفض التنفيذ ما دامت هناك تغييرات معلّقة.
  (يمكن تفعيل `autoApply` اختيارياً — لكنه معطّل افتراضياً.)
- **16 أداة**:
  `read_file` · `list_files` · `write_file` · `edit_file` · `delete_file` · `search_project` ·
  `git_status` · `git_diff` · `git_log` · `git_commit` · `run_command` · `verify_code` ·
  `plan_tasks` · `update_task` · `read_memory` · `write_memory`

### 4. الموجه الذكي (Model Router)

طبقة واحدة تفصل بقية التطبيق عن المزوّدين تماماً:

```
واجهة المستخدم  →  /api/chat  →  Model Router  →  { Workers AI | OpenRouter | Custom | Diagnostic }
```

- **أربع فئات**: `chat` · `reasoning` · `coding` · `longContext` — تغيّر الفئة دون لمس أي كود آخر.
- **ترتيب أولوية قابل للضبط** (`NOVA_PROVIDER_PRIORITY`)؛ يستخدم أول مزوّد مُعَدّ ويخدم النموذج المطلوب.
- **لا يزيّف النجاح أبداً**: إن لم يكن هناك مزوّد قابل للاستدعاء يرمي `ProviderNotConfiguredError`
  وتظهر للمستخدم رسالة تشرح ما يجب إعداده.
- **لا يختار نماذج مقفلة** (gated) أبداً — يتخطاها تلقائياً.

### 5. التصميم

- واجهة داكنة مستوحاة من Claude / Cursor.
- **عربي RTL + إنجليزي LTR** — التبديل فوري ويُحفظ في الإعدادات.
- شريط جانبي، محرر، لوحة طرفية، ولوحات قابلة للطي.
- **متجاوب**: يعمل على الموبايل (السكك الجانبية تُغلق تلقائياً تحت عرض معين).
- Tailwind CSS + خطوط نظامية (لا اعتماد على CDN خارجي في وقت التشغيل).

</div>

---

<div dir="rtl">

## التشغيل السريع

### المتطلبات

- **Node.js ≥ 20** (تم الاختبار على 20/22)
- **npm ≥ 10**
- ذاكرة: البناء الإنتاجي يحتاج ~768MB — انظر [ملاحظة الذاكرة](#ملاحظة-الذاكرة)

### 1. التثبيت

```bash
git clone <repo> && cd nova-ai-cloud
npm install
```

<details>
<summary><b>ملاحظة الذاكرة</b> — إن كان جهازك/حاويتك محدوداً بـ 1GB RAM</summary>

```bash
export NODE_OPTIONS=--max-old-space-size=480
npm install --workspaces=false --no-audit --no-fund --maxsockets=2 --ignore-scripts
for w in @nova/shared @nova/web @nova/worker @nova/sandbox-worker; do
  npm install -w "$w" --no-audit --no-fund --maxsockets=2 --ignore-scripts
done
```

البناء الإنتاجي يجب أن يعمل **والخوادم متوقفة**:

```bash
cd apps/web && NODE_OPTIONS=--max-old-space-size=768 npx vite build
```
</details>

### 2. الإعداد

```bash
cp .env.example apps/worker/.dev.vars
```

افتح `apps/worker/.dev.vars` واضبط ما تحتاجه. **الحد الأدنى للتشغيل: لا شيء** —
التطبيق يعمل بوضع `NOVA_SANDBOX=disabled` ويخبرك بوضوح ما يحتاجه.

### 3. قاعدة البيانات

```bash
npm run db:migrate:local
```

### 4. التشغيل

```bash
npm run dev              # يشغّل API (8787) + الواجهة (5173) معاً
# أو
npm run dev:sandbox      # نفس الشيء + خادم sandbox مرجعي (8790) — ⚠️ انظر docs/SANDBOX.md
```

ثم افتح:

| العنوان | الوصف |
|---|---|
| **http://localhost:5173** | بيئة التطوير (Vite + HMR) — **استخدم هذا** |
| http://localhost:8787 | API + نسخة الإنتاج المبنية |
| http://localhost:8790 | خادم Sandbox المرجعي (مع `dev:sandbox`) ⚠️ بدون عزل |
| http://localhost:8788 | Sandbox Worker المعزول (`npm run dev:sandbox-worker`) |

### 5. التحقّق

```bash
npm run smoke            # 26 فحصاً على خادم حي
npm test                 # 121 اختباراً (backend + web)
npm run typecheck        # tsc --strict على worker و web
```

</div>

---

<div dir="rtl">

## الإعدادات

كل الأسرار **في الخادم فقط** (`.dev.vars` / `.env`). الواجهة لا ترى أي مفتاح إطلاقاً —
تتحدث فقط مع `/api/*`.

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `NOVA_RUNTIME` | `workers` | `workers` أو `node` (تشغيل محلي بمخزن ملفات) |
| `NOVA_PROVIDER_PRIORITY` | `workers-ai,openrouter,custom` | ترتيب المزوّدين |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | — | لتشغيل Workers AI عن بُعد |
| `OPENROUTER_API_KEY` | — | نماذج OpenRouter (المجانية تنتهي بـ `:free`) |
| `GROQ_API_KEY` | — | ⚠️ انظر التحذير في [docs/MODELS.md](docs/MODELS.md) |
| `NOVA_CUSTOM_BASE_URL` / `_API_KEY` / `_MODELS` | — | أي endpoint متوافق مع OpenAI |
| `NOVA_MODEL_CHAT` / `_REASONING` / `_CODING` / `_LONG_CONTEXT` | — | تجاوز النموذج الافتراضي لكل فئة |
| `NOVA_ENABLE_DIAGNOSTIC` | `false` | مزوّد **صَدى تشخيصي** — ليس نموذج ذكاء اصطناعي |
| `NOVA_ALLOW_RUNTIME_KEYS` / `NOVA_ADMIN_TOKEN` | `false` / — | حقن مفاتيح في الذاكرة فقط (لا تُخزَّن) |
| `NOVA_SANDBOX` | **`disabled`** | `disabled` · `worker` · `http` |
| `NOVA_SANDBOX_URL` / `_TOKEN` / `_TIMEOUT_MS` | — / — / `20000` | إعداد الـ Sandbox الخارجي |
| `NOVA_DATA_DIR` | `./.nova-data` | مخزن الملفات (وضع Node فقط) |
| `NOVA_ALLOWED_ORIGINS` | — | CORS؛ فارغ = نفس المصدر فقط |
| `NOVA_MAX_UPLOAD_BYTES` | `8388608` | حدّ الرفع (8MB) |

### المزوّد الصَدى التشخيصي

عند `NOVA_ENABLE_DIAGNOSTIC=true` يظهر مزوّد `diagnostic:echo`. هذا **ليس نموذج ذكاء اصطناعي**:
يعيد نصّك كما هو، وغرضه اختبار البثّ والأدوات والتخزين بدون أي مفتاح.
كل ردّ يُصدِره يبدأ بتحذير صريح `⚠️ DIAGNOSTIC ECHO — this is not an AI model response`، وتحمل الرسالة `warnings` تُعرض عليها، وتظهر في الإعدادات شارة «echo — NOT an AI model». يدعم `/tool <name> {json}` لاختبار استدعاء الأدوات.
لا يمكن أبداً أن يُقدَّم على أنه إجابة ذكية.

</div>

---

<div dir="rtl">

## البنية المعمارية

Monorepo بـ npm workspaces:

```
nova-ai-cloud/
├── packages/shared/          الأنواع والعقود المشتركة (TS)
│   └── src/
│       ├── types.ts          أنواع النطاق
│       ├── api.ts            عقود الطلب/الاستجابة
│       ├── sse.ts            محلّل SSE (مُستخدم في الطرفين)
│       ├── diff.ts           حساب وعرض الفروقات
│       ├── validation.ts     تحقّق آمن من المدخلات
│       ├── lang.ts           كشف اللغة والاتجاه
│       ├── ids.ts            معرّفات
│       └── catalog/          كتالوج النماذج الموثَّق (workers-ai, openrouter)
│
├── apps/worker/              الـ Backend (Cloudflare Workers)
│   ├── src/
│   │   ├── index.ts          نقطة دخول Workers
│   │   ├── node.ts           نفس التطبيق على Node (تطوير محلي)
│   │   ├── app.ts            Hono app + CORS + معالجة الأخطاء
│   │   ├── bootstrap.ts      حقن الاعتماديات (يقبل sandbox اختياري)
│   │   ├── env.ts            قراءة وضبط البيئة
│   │   ├── routes/           health · models · chat · conversations ·
│   │   │                     projects · agent · sandbox · misc
│   │   ├── ai/
│   │   │   ├── router.ts     ← الموجه الذكي
│   │   │   ├── registry.ts   سجل المزوّدين
│   │   │   └── providers/    workers-ai · openai-compatible · diagnostic
│   │   ├── agent/
│   │   │   ├── loop.ts       حلقة الوكيل (تفكيك، أدوات، إصلاح)
│   │   │   ├── permissions.ts سياسة الموافقة قبل التطبيق
│   │   │   ├── git.ts        Git بمخازن مُعنوَنة بالمحتوى
│   │   │   ├── prompts.ts    أوامر النظام
│   │   │   └── tools/        files · git-tools · terminal · planning · memory
│   │   ├── sandbox/          disabled · worker-isolate · http
│   │   └── storage/          d1-store · json-store · blob
│   └── migrations/0001_init.sql   17 جدولاً
│
├── apps/web/                 الواجهة (React 18 + TypeScript + Tailwind)
│   └── src/
│       ├── pages/            ChatPage · CodePage
│       ├── components/       chat/ · code/ · layout/ · settings/ · ui/
│       ├── store/            zustand: app · chat · code
│       ├── i18n/             عربي + إنجليزي
│       └── lib/              api · sse · format
│
├── sandbox/worker/           Sandbox Worker معزول (بدون أي bindings)
├── scripts/                  dev · smoke · sandbox-reference-server · sandbox-selftest
└── tests/                    109 اختبار backend
```

**مبدأ التصميم**: لا يوجد ملف واحد ضخم. كل وحدة مسؤولة عن شيء واحد،
والاعتماديات تُحقن عبر `bootstrap()` لتسهيل الاختبار.

### مسارات API (50)

| المجموعة | أمثلة |
|---|---|
| الصحة | `GET /api/health` · `GET /api/sandbox/status` |
| النماذج | `GET /api/models` · `POST /api/models/probe` · `POST /api/models/refresh` |
| المحادثة | `POST /api/chat` (SSE) · `GET/POST/PATCH/DELETE /api/conversations*` |
| المشاريع | `GET/POST/PATCH/DELETE /api/projects*` · `/files` · `/file` · `/search` · `/diff` |
| التغييرات | `GET /api/projects/:id/changes` · `POST /api/changes/:changeId` · `/apply-all` |
| Git | `/git/status` · `/git/push` · `POST /api/projects/:id/commits` · `GET .../commits/:commitId` |
| الوكيل | `POST /api/agent/run` (SSE) · `GET /api/agent/runs*` |
| المهام | `GET/POST/PATCH/DELETE /api/tasks*` |
| الذاكرة | `GET/POST/DELETE /api/memory*` |
| الملفات المرفوعة | `POST /api/uploads` · `GET /api/uploads/:id` |
| الـ Sandbox | `POST /api/sandbox/exec` · `GET /api/sandbox/status` |
| الإعدادات | `GET/PUT /api/settings` · `GET /api/usage` · `POST/GET /api/admin/provider-keys` |

التفاصيل الكاملة في [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

</div>

---

<div dir="rtl">

## النماذج

**قاعدة صارمة التزمنا بها**: لا نفترض أن نموذجاً مجاني لأنه مفتوح المصدر.
كل نموذج في الكتالوج له `verifiedAt` وتوثيق لسياسة التسعير الفعلية.

التفاصيل الكاملة — بما فيها قوائم النماذج المجانية والمدفوعة والمقفلة — في
**[docs/MODELS.md](docs/MODELS.md)**.

ملخّص سريع (تم التحقق 2026-10-30):

| المزوّد | المجاني؟ | الحدّ | يحتاج بطاقة؟ |
|---|---|---|---|
| **Cloudflare Workers AI** | ✅ نعم | 10,000 Neurons/يوم (يُصفَّر 00:00 UTC) | ❌ لا |
| **OpenRouter `:free`** | ✅ نعم | 20 طلب/دقيقة + 50 طلب/يوم (أو 1000/يوم بعد $10 رصيد) | ❌ لا |

> ⚠️ **اكتشاف مُتحقَّق منه بالتجربة (2026-10-30)**: بعض نماذج `:free` ترفض المفتاح
> العادي بـ **403 «only available on agentic harnesses»**، والـ API العام **لا يكشف**
> هذا القيد. فحصنا الـ١٩ نموذجاً المجانية واحداً واحداً: **٨ تعمل**، ٢ محجوبة،
> والباقي 429/غير نصي. التفاصيل و`npm run probe:openrouter` في [docs/MODELS.md](docs/MODELS.md).
| **Groq** | ⚠️ **لا** | أغلب نماذج المحادثة صارت Enterprise/مدفوعة | ✅ نعم عادةً |

نماذج **مدفوعة فقط** تم استبعادها من الاختيار التلقائي:
`glm-5.3` · `glm-5.3-flash` · `kimi-k2.7-code` · `deepseek-v4-flash-0731` · `deepseek-v4-pro-0813`

نماذج **مقفلة** (تحتاج طلب وصول) — الموجه يتخطاها:
`@cf/swiss-ai/apertus-v1.5-8b` · `@cf/utter-project/eurollm-9b-it`

</div>

---

<div dir="rtl">

## الـ Sandbox

**قاعدة غير قابلة للتفاوض: لا يُنفَّذ أي أمر على الخادم الرئيسي.**

ثلاثة أوضاع:

| الوضع | الوصف | اللغات | العزل |
|---|---|---|---|
| `disabled` | **الافتراضي (fail-closed)** — يُعيد خطأً صريحاً «غير مُعَد» | — | — |
| `worker` | Sandbox Worker مستقل عبر service binding | JavaScript فقط | ✅ isolate حقيقي (بدون fs/net) |
| `http` | أي خدمة خارجية تنفّذ عقد NOVA | shell · js · ts · python | ⚠️ يعتمد على مزوّدك |

- **سياسة الأوامر** (`classifyCommand`) تُطبَّق في **مكانين**: داخل أداة الوكيل `run_command`
  **و** على مسار `/api/sandbox/exec` المباشر. الأوامر المحظورة تُعيد `400 command_blocked`.
- **الطرفية تتطلب إذناً لكل تشغيل** (`allowTerminal`) — لا يمكن للوكيل تفعيلها بنفسه.
- **انتهاء المهلة يقتل مجموعة العمليات كاملة** (`detached` + `kill(-pid)`) حتى لا تبقى عمليات حفيدة.

⚠️ **`scripts/sandbox-reference-server.mjs` هو تنفيذ مرجعي للعقد فقط — لا يوفّر عزلاً بنفسه.**
شغّله داخل حاوية قابلة للتخلّص منها (Docker/Firecracker/gVisor)، وليس على جهازك مباشرة.

الدليل الكامل + العقد + أمثلة curl في **[docs/SANDBOX.md](docs/SANDBOX.md)**.

```bash
npm run sandbox:selftest   # 10 فحوصات للعقد
```

</div>

---

<div dir="rtl">

## الاختبارات

```bash
npm test                 # 121 اختباراً (backend 109 + web 12)
npm run test:backend     # 107
npm run test:web         # 12
npm run test:watch       # وضع المراقبة
npm run smoke            # 26 فحصاً على خادم حي
npm run sandbox:selftest # 10 فحوصات لعقد الـ Sandbox
npm run probe:openrouter # أي نموذج مجاني يعمل فعلاً بمفتاحك
npm run verify:openrouter# تحقق طرفاً لطرف من OpenRouter (يتطلب مفتاحاً)
npm run typecheck        # tsc --strict (worker + web)
```

| المجموعة | العدد | ماذا تغطي |
|---|---|---|
| `tests/shared.test.ts` | 17 | الأنواع، diff، SSE، validation، lang، ids |
| `tests/router.test.ts` | 23 | اختيار المزوّد، الأولوية، النماذج المقفلة (تشمل حجب agentic harness)، الأخطاء الصريحة |
| `tests/agent.test.ts` | 37 | حلقة الوكيل، الأدوات، الموافقة، Git، تفكيك المهام |
| `tests/api.test.ts` | 32 | المسارات (منها 6 لسياسة الـ Sandbox) |
| `apps/web/src/__tests__/app.test.tsx` | 9 | تكامل الواجهة مع mock API |
| `apps/web/src/__tests__/editor.test.tsx` | 3 | **CodeMirror حقيقي** (يعرض، يبلّغ عن التعديلات، وضع القراءة) |

اختبارات الواجهة تستخدم **CodeMirror فعلياً** (وليس بديلاً) مع shims لقياسات jsdom.

</div>

---

<div dir="rtl">

## النشر

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy           # يبني الواجهة ثم ينشر الـ Worker
```

`wrangler.jsonc` يربط: **D1** (`DB`) · **R2** (`FILES`) · **AI** · وخدمة الـ Sandbox (اختياري).

### قائمة تحقّق قبل النشر

- [ ] `.dev.vars` **لا** يُرفع إلى git (مدرج في `.gitignore`)
- [ ] الأسرار مضبوطة عبر `wrangler secret put` — وليس في الكود
- [ ] `NOVA_SANDBOX` مضبوط بوعي (`disabled` إن لم تكن جاهزاً)
- [ ] `NOVA_ALLOWED_ORIGINS` يحدّد نطاقك فقط
- [ ] لم تفعّل أي مزوّد مدفوع دون قصد
- [ ] `npm run smoke` ناجح على الرابط المنشور

⚠️ **لا تفعّل أي مزوّد مدفوع دون موافقة صريحة.** الموجه لا يفعل ذلك تلقائياً أبداً.

</div>

---

<div dir="rtl">

## الحدود المعروفة

نلتزم بقاعدة واحدة: **لا نزيّف نجاحاً**. هذه هي الحدود الصريحة:

1. **Workers AI محلياً**: `env.AI.run` يرمي `"Binding AI needs to be run remotely"` في
   `wrangler dev` العادي. الحل: `wrangler dev --remote` + `wrangler login`.
   حتى ذلك الحين يُبلغ الموجه عن `needs-remote` بدل توليد مخرجات وهمية.

2. **لا يوجد «نموذج مجاني بلا أي إعداد»**. أقرب خيار هو **OpenRouter `:free`**
   (50 طلب/يوم، بدون بطاقة ائتمانية) — لكنه يتطلب مفتاحاً مجانياً منك.
   بدون أي مفتاح ستحصل على رسالة خطأ واضحة تشرح ما يجب فعله، لا على إجابة ملفّقة.
   **وحتى مع المفتاح**: ٨ نماذج مجانية فقط من أصل ١٩ تعمل فعلياً — انظر التحذير أعلاه.
   ✅ **تم التحقق طرفاً لطرف**: `nvidia/nemotron-3.5-lightning:free` أجاب عبر SSE وحُفظ في D1.

3. **Groq ليس مجانياً** (تم التحقق 2026-10-30) — نماذج المحادثة صارت Enterprise.
   لا ندّعي خلاف ذلك.

4. **وضع `worker` في الـ Sandbox ينفّذ JavaScript فقط** — لا نظام ملفات ولا شبكة.
   للـ Python/shell تحتاج وضع `http` مع خدمة خارجية.

5. **الخادم المرجعي للـ Sandbox لا يوفّر عزلاً** — هو تنفيذ للعقد فقط.

6. **مزامنة GitHub اختيارية** وتتطلب `GITHUB_TOKEN` + `GITHUB_REPO`؛
   عند عدم الإعداد تفشل برسالة صريحة بدل التظاهر بالنجاح.

7. **لا يوجد تنفيذ نماذج محلي** — وهذا مقصود حسب المتطلبات.

</div>

---

<div dir="rtl">

## نسخة سطح المكتب (Windows)

تطبيق Windows حقيقي بنافذة مستقلة ومثبّت NSIS — **بجانب** نسخة الويب (لم تُحذف):

- `NOVA-AI-Cloud-Setup.exe` — مثبّت: اختصار سطح المكتب + قائمة Start + Uninstaller
- `NOVA-AI-Cloud-Portable.zip` — نسخة محمولة جاهزة للتشغيل بدون تثبيت
- إدخال وحفظ مفتاح OpenRouter المجاني مباشرة من داخل **الإعدادات ← المزوّدون** (بدون لمس ملفات `.env`)
- التحديثات الذاتية جاهزة ومربوطة (tauri-plugin-updater) وتعمل تلقائياً عند نشر release موقّع

**البناء والاختبار يحدثان على ويندوز حقيقي عبر GitHub Actions** — الوظيفة
`test-install` تُثبّت المثبّت صامتاً داخل الـ Runner، تفحص الاختصارات والملفات،
تشغّل التطبيق وتتأكد أنه شغّل خادمه، ثم تزيله وتتأكد من النظافة.

> ⚠️ بيئة التطوير هنا Linux ولا تملك ويندوز — لذلك لا يُدَّعى أي اختبار ويندوز
> خارج الـ Runner أو جهازك.

الدليل الكامل (التثبيت، التحديث، الإزالة، استخراج الـ EXE من Artifacts):
**[docs/DESKTOP.md](docs/DESKTOP.md)**

</div>

---

## English summary

**NOVA AI Cloud** is a personal AI platform that runs entirely in the browser on
Cloudflare's free tier (Workers + D1 + R2). It combines three roles in one app:

- **Chat** — streaming UI, model picker, saved conversations, file uploads, per-project memory.
- **IDE** — file tree, real CodeMirror 6 editor, project search, terminal panel, Git panel.
- **Coding agent** — decomposes complex tasks, edits files, shows every change as a **diff you must
  approve before it is applied**, reviews and repairs errors.

**Design principles actually enforced in code:**

| Principle | How |
|---|---|
| No fake AI | The router throws `ProviderNotConfiguredError` instead of inventing output; the diagnostic echo provider is labeled "NOT an AI model" in the catalog, prefixes every response with `⚠️ DIAGNOSTIC ECHO — this is not an AI model response`, and is badged as an echo in Settings. |
| No keys in the frontend | Secrets live in `.dev.vars`/`.env`; the web app only ever calls `/api/*`. |
| No silent paid providers | Paid-only models (`glm-5.3`, `kimi-k2.7-code`, `deepseek-v4-*`) are catalogued as paid and never auto-selected. |
| Never assume open-source = free | Every catalog entry carries a `verifiedAt` date and the provider's actual pricing terms. |
| No commands on the main server | Sandbox defaults to `disabled` (fail-closed). `worker` mode is a zero-binding isolate (JS only). `http` mode delegates to an external service. The command policy is enforced at **both** the agent tool and the direct route. |
| Modular, not single-file | npm workspaces monorepo; dependency injection via `bootstrap()`. |

**Status:** 119 tests passing · smoke 26/26 · sandbox self-test 10/10 · strict typecheck clean ·
production build served by Workers · external sandbox integration verified end-to-end.

**Docs:** [ARCHITECTURE](docs/ARCHITECTURE.md) · [MODELS](docs/MODELS.md) · [SANDBOX](docs/SANDBOX.md)

---

<div dir="rtl">

## الترخيص

هذا مشروع شخصي. استخدمه كما تشاء، لكن تحقّق من شروط كل مزوّد نماذج قبل الاستخدام التجاري.

</div>
