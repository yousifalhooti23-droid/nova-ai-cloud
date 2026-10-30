# MODELS — كتالوج النماذج وسياسة التسعير

<div dir="rtl">

## القاعدة التي بُني عليها هذا الملف

> **لا نفترض أبداً أن نموذجاً مجاني لمجرد أنه مفتوح المصدر.**
>
> كل إدخال في الكتالوج يحمل: `freeTier` (`free` / `paid` / `unknown`)، و`access`
> (`open` / `gated`)، و`pricing` الفعلي لكل مليون رمز، و`verifiedAt` بتاريخ التحقق،
> و`verifiedSource` بالرابط الذي فُحص. لا توجد تخمينات.

**آخر تحقق شامل: 2026-10-30** — بمسح 73 صفحة نموذج في Cloudflare Workers AI،
وقائمة OpenRouter العامة الحيّة (`/api/v1/models`)، وصفحة نماذج Groq.

---

## الملخّص

| المزوّد | النماذج | مجاني؟ | يتطلب مفتاحاً؟ | يتطلب بطاقة؟ |
|---|---|---|---|---|
| **Cloudflare Workers AI** | 22 (منها 17 مجانية، 2 مقفلة) | ✅ 10,000 Neurons/يوم | ❌ لا | ❌ لا |
| **OpenRouter** | 16 بذرة (٨ مُتحقَّق أنها تعمل، ٢ محجوبة) | ✅ 50 طلب/يوم | ✅ نعم (مجاني) | ❌ لا |
| **Groq** | 0 في الكتالوج | ⚠️ **غير مؤكد** | ✅ نعم | ⚠️ غالباً |
| **Custom (OpenAI-compatible)** | حسب endpoint | ⚠️ يعتمد | ✅ نعم | ⚠️ يعتمد |
| **Diagnostic echo** | 1 | ✅ | ❌ | ❌ |
| **المجموع المعروض** | **39** | | | |

> ⚠️ **Groq**: تم الفحص في 2026-10-30 — صفحة النماذج تعرض أسعاراً لكل رمز لمعظم نماذج
> المحادثة، وتضع Llama 3.1/3.3 تحت «Enterprise — Contact Sales». لذلك **لم نضف أي نموذج Groq
> إلى الكتالوج**، و`requiresCard` مضبوط `null` (= غير مُتحقَّق) لا `false`. لا ندّعي أنه مجاني.

---

## كيف يقرأ الموجه الكتالوج

ترتيب الاختيار عند طلب فئة معيّنة:

```
1. هل النموذج مُحدَّد صراحةً؟        → استخدمه إن كان المزوّد مُعَدّاً
2. امشِ على NOVA_PROVIDER_PRIORITY   → workers-ai ثم openrouter ثم custom
3. لكل مزوّد: هل هو configured؟      → وإلا تجاوزه مع سبب صريح
4. هل النموذج access === 'gated'؟    → ❌ يتخطاه دائماً (لا يرمي خطأً غامضاً)
5. المفاضلة: الأولوية → مجاني → يدعم الأدوات → حجم السياق
6. لا يوجد شيء قابل للاستدعاء؟       → ProviderNotConfiguredError برسالة تشرح المطلوب
```

**الخطوة 6 هي جوهر السياسة**: بدل اختلاق إجابة، تظهر للمستخدم رسالة تقول بالضبط
أي متغير بيئة يجب ضبطه.

### حالة المزوّدين (من `/api/models` الحي)

| المزوّد | الحالة | التفصيل |
|---|---|---|
| `workers-ai` | `needs-remote` | الـ binding يعمل عن بُعد فقط؛ تحت `wrangler dev --local` يرمي `"Binding AI needs to be run remotely"` |
| `openrouter` | `missing-key` | `OPENROUTER_API_KEY` غير مضبوط |
| `groq` | `missing-key` | `GROQ_API_KEY` غير مضبوط |
| `custom` | `missing-key` | `NOVA_CUSTOM_BASE_URL` غير مضبوط |
| `diagnostic` | `ready` | مفعّل — **وليس نموذج ذكاء اصطناعي** |

الواجهة تعرض كل مزوّد **حتى غير المُعَد** — مخفوتاً مع السبب — فلا تُخفي خيارات بصمت.

---

## Cloudflare Workers AI (22)

**الخطة المجانية**: 10,000 Neurons/يوم، مشتركة، تُصفَّر عند 00:00 UTC.
**الأعمدة أدناه**: «التسعير» هو سعر **ما يتجاوز** الحصة المجانية (بالدولار لكل مليون رمز
إدخال/إخراج) — وجود سعر لا يعني أن النموذج مدفوع؛ عمود «مجاني» هو الحاسم.

| النموذج | `upstreamId` | الفئات | السياق | أدوات | مجاني | التسعير ($/M) | الوصول |
|---|---|---|---|---|---|---|---|
| Apertus 1.5 8B | `@cf/swiss-ai/apertus-v1.5-8b` | chat, long | 262k | ✅ | ✅ | — | 🔒 |
| DeepSeek R1 Distill Qwen 32B | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | reasoning | 80k | ❌ | ✅ | $0.497 / $4.881 | مفتوح |
| DeepSeek V4 Flash | `@cf/deepseek-ai/deepseek-v4-flash-0731` | chat, coding, long | 1.0M | ✅ | 💰 | $0.44 / $1.32 | مفتوح |
| DeepSeek V4 Pro | `@cf/deepseek-ai/deepseek-v4-pro-0813` | reasoning, long | 1.0M | ✅ | 💰 | $1.32 / $3.96 | مفتوح |
| EuroLLM 9B Instruct | `@cf/utter-project/eurollm-9b-it` | chat | 32k | ✅ | ✅ | — | 🔒 |
| Gemma 4 26B (A4B) | `@cf/google/gemma-4-26b-a4b-it` | chat, long | 256k | ✅ | ✅ | $0.1 / $0.3 | مفتوح |
| GLM 4.7 Flash | `@cf/zai-org/glm-4.7-flash` | chat, coding | 131k | ✅ | ✅ | $0.0605 / $0.4 | مفتوح |
| GLM 5.3 (1M context) | `@cf/zai-org/glm-5.3` | coding, reasoning, long | 1.0M | ✅ | 💰 | $1.4 / $4.4 | مفتوح |
| GLM 5.3 Flash | `@cf/zai-org/glm-5.3-flash` | chat, coding, long | 1.0M | ✅ | 💰 | $0.15 / $0.5 | مفتوح |
| GPT-OSS 120B | `@cf/openai/gpt-oss-120b` | chat, reasoning, coding | 128k | ✅ | ✅ | $0.35 / $0.75 | مفتوح |
| GPT-OSS 20B | `@cf/openai/gpt-oss-20b` | chat, reasoning | 128k | ✅ | ✅ | $0.2 / $0.3 | مفتوح |
| Granite 4.0 H Micro | `@cf/ibm-granite/granite-4.0-h-micro` | chat | 131k | ✅ | ✅ | $0.017 / $0.112 | مفتوح |
| Kimi K2.7 Code (1T MoE) | `@cf/moonshotai/kimi-k2.7-code` | coding, long | 262k | ✅ | 💰 | $0.95 / $4 | مفتوح |
| Llama 3.2 Vision 11B | `@cf/meta/llama-3.2-11b-vision-instruct` | chat | 128k | ❌ | ✅ | $0.0485 / $0.676 | مفتوح |
| Llama 3.3 70B Instruct (fast) | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | chat, coding | 24k | ✅ | ✅ | $0.293 / $2.253 | مفتوح |
| Llama 4 Scout 17B (16E) | `@cf/meta/llama-4-scout-17b-16e-instruct` | chat, long | 131k | ✅ | ✅ | $0.27 / $0.85 | مفتوح |
| Mistral Small 3.1 24B | `@cf/mistralai/mistral-small-3.1-24b-instruct` | chat, coding | 128k | ✅ | ✅ | $0.351 / $0.555 | مفتوح |
| Nemotron 3 120B (A12B) | `@cf/nvidia/nemotron-3-120b-a12b` | chat, reasoning, long | 256k | ✅ | ✅ | $0.5 / $1.5 | مفتوح |
| Qwen 3.8 27B | `@cf/qwen/qwen3.8-27b` | chat, coding, long | 262k | ✅ | ✅ | $0.45 / $3.2 | مفتوح |
| Qwen2.5 Coder 32B | `@cf/qwen/qwen2.5-coder-32b-instruct` | coding | 33k | ❌ | ✅ | $0.66 / $1 | مفتوح |
| Qwen3 30B (A3B, fp8) | `@cf/qwen/qwen3-30b-a3b-fp8` | chat, coding | 33k | ✅ | ✅ | $0.0509 / $0.335 | مفتوح |
| QwQ 32B | `@cf/qwen/qwq-32b` | reasoning | 24k | ❌ | ✅ | $0.66 / $1 | مفتوح |

**المجانية القابلة للاستخدام فوراً (بدون بطاقة، ضمن 10k Neurons/يوم) — 15 نموذجاً:**

- `workers-ai:deepseek-r1-distill-qwen-32b` — بدون استدعاء أدوات
- `workers-ai:gemma-4-26b-a4b-it`
- `workers-ai:glm-4.7-flash`
- `workers-ai:gpt-oss-120b`
- `workers-ai:gpt-oss-20b`
- `workers-ai:granite-4.0-h-micro`
- `workers-ai:llama-3.2-11b-vision-instruct` — بدون استدعاء أدوات
- `workers-ai:llama-3.3-70b-instruct-fp8-fast`
- `workers-ai:llama-4-scout-17b-16e-instruct`
- `workers-ai:mistral-small-3.1-24b-instruct`
- `workers-ai:nemotron-3-120b-a12b`
- `workers-ai:qwen3.8-27b`
- `workers-ai:qwen2.5-coder-32b-instruct` — بدون استدعاء أدوات
- `workers-ai:qwen3-30b-a3b-fp8`
- `workers-ai:qwq-32b` — بدون استدعاء أدوات

---

## OpenRouter — 16 نموذجاً (كلها مجانية)

| النموذج | `upstreamId` | الفئات | السياق | أدوات | رؤية |
|---|---|---|---|---|---|
| dots.3 Note Preview (free) | `dots-studio/dots-3-note-preview:free` | chat | 512k | ✅ | ✅ |
| Flint v1.0 (free) | `recursive/flint-v1.0:free` | chat, reasoning | 262k | ✅ | ❌ |
| Gemma 4 26B A4B IT (free) | `google/gemma-4-26b-a4b-it:free` | chat, long | 262k | ✅ | ✅ |
| Gemma 4 31B IT (free) | `google/gemma-4-31b-it:free` | chat, long | 262k | ✅ | ✅ |
| Inkling (free) 🔒 | `thinkingmachines/inkling:free` | chat, reasoning, long | 1.0M | ✅ | ✅ |
| Inkling Small (free) 🔒 | `thinkingmachines/inkling-small:free` | chat, long | 1.0M | ✅ | ✅ |
| Laguna S 2.1 (free) | `poolside/laguna-s-2.1:free` | coding, chat | 262k | ✅ | ❌ |
| Laguna XS 2.1 (free) | `poolside/laguna-xs-2.1:free` | coding, chat | 262k | ✅ | ❌ |
| LFM 2.5 2.6B (free) | `liquid/lfm-2.5-2.6b:free` | chat | 66k | ✅ | ❌ |
| Nemotron 3 Nano Omni Reasoning (free) | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | reasoning | 256k | ✅ | ✅ |
| Nemotron 3 Ultra 550B (free) | `nvidia/nemotron-3-ultra-550b-a55b:free` | reasoning, coding, long | 1M | ✅ | ❌ |
| Nemotron 3.5 Lightning (free) | `nvidia/nemotron-3.5-lightning:free` | chat, coding, long | 1M | ✅ | ❌ |
| Nemotron 3.5 Super VL (free) | `nvidia/nemotron-3.5-super-vl:free` | chat, long | 1M | ✅ | ✅ |
| North Mini Code (free) | `cohere/north-mini-code:free` | coding | 256k | ✅ | ❌ |
| OpenRouter Free Auto-Router | `openrouter/free` | chat | 200k | ✅ | ✅ |
| Xing 4.0 29B A4B (free) | `xingchen-agi/xing4.0-29b-a4b:free` | chat | 262k | ✅ | ❌ |

### 🔒 نماذج مقفلة (تحتاج طلب وصول) — الموجه يتخطاها

| النموذج | السبب |
|---|---|
| `@cf/swiss-ai/apertus-v1.5-8b` | صفحة النموذج تتطلب ملء استمارة طلب وصول قبل الاستخدام |
| `@cf/utter-project/eurollm-9b-it` | كذلك — استمارة وصول |

### 💰 نماذج مدفوعة فقط — **لا تُختار تلقائياً أبداً**

| النموذج | ملاحظة |
|---|---|
| `@cf/zai-org/glm-5.3` | مدفوع فقط |
| `@cf/zai-org/glm-5.3-flash` | مدفوع فقط |
| `@cf/moonshotai/kimi-k2.7-code` | مدفوع فقط (1T MoE) |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | مدفوع فقط |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | مدفوع فقط |

> هذه النماذج **موجودة في الكتالوج وموثّقة كمدفوعة** — حتى ترى في الواجهة أنها تتطلب
> إعداداً مدفوعاً، وحتى لا يختارها الموجه بالخطأ. لا نفعّل أي مزوّد مدفوع دون موافقتك الصريحة.

### نماذج غير مفهرسة في Cloudflare

`glm-5.2` · `kimi-k2.6` · `deepseek-v4.1-flash-1017` — لم نجدها في الفهرس عند التحقق،
لذلك **لم تُضَف**. (القاعدة: لا نضيف نموذجاً لم نتحقق من توفره.)

---

## OpenRouter (16 — كلها `:free`)

**حدود النماذج المجانية** (من `openrouter.ai/docs/api-reference/limits`، تحقّق 2026-10-30):

| رصيدك التراكمي | الحدّ |
|---|---|
| أقل من $10 | 20 طلب/دقيقة · **50 طلب/يوم** |
| $10 أو أكثر | 20 طلب/دقيقة · **1000 طلب/يوم** |

**لا حاجة لبطاقة ائتمانية** لإنشاء حساب واستخدام النماذج المجانية.

### 🔒 قيد «agentic harness» — اكتشاف مُتحقَّق منه بالتجربة (2026-10-30)

> **بعض نماذج `:free` ترفض المفتاح العادي بـ HTTP 403:**
> `"… is only available on agentic harnesses. Try plugging it into a coding agent or
> productivity app listed on https://openrouter.ai/apps"`

**والأخطر**: الـ API العام `GET /api/v1/models` **لا يكشف هذا القيد إطلاقاً** —
`pricing` صفر و`per_request_limits: null`، فيبدو النموذج مجانياً متاحاً وهو ليس كذلك.
**الطريقة الوحيدة لمعرفة الحقيقة هي استدعاؤه فعلاً.**

لذلك أضفنا `npm run probe:openrouter` (`scripts/probe-openrouter-free.mjs`) الذي يجرب
كل نموذج مجاني بطلب من ٤ رموز فقط، بتباطؤ ٣٫٣ ثانية (تحت حدّ ٢٠ طلباً/دقيقة).

#### نتيجة الفحص الحيّ بمفتاح عادي — ١٩ نموذجاً مجانياً

| الحالة | العدد | النماذج |
|---|---|---|
| ✅ **تعمل** | **8** | `nvidia/nemotron-3.5-lightning:free` (1M) · `nvidia/nemotron-3.5-super-vl:free` (1M) · `nvidia/nemotron-3-ultra-550b-a55b:free` (1M) · `dots-studio/dots-3-note-preview:free` (512k) · `poolside/laguna-s-2.1:free` (262k) · `cohere/north-mini-code:free` (256k) · `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (256k) · `openrouter/free` (200k) — **كلها تدعم استدعاء الأدوات** |
| 🔒 **محجوبة** (agentic harness) | 2 | `thinkingmachines/inkling:free` · `thinkingmachines/inkling-small:free` |
| ⚠️ **429 / غير متاحة لحظياً** | 5 | `recursive/flint-v1.0:free` · `xingchen-agi/xing4.0-29b-a4b:free` · `liquid/lfm-2.5-2.6b:free` · `poolside/laguna-xs-2.1:free` · `google/gemma-4-26b-a4b-it:free` · `google/gemma-4-31b-it:free` |
| ⛔ ليست نماذج محادثة | 3 | `nvidia/nemotron-3.5-content-safety:free` (404) · `google/lyria-3-pro-preview` (400) · `google/lyria-3-clip-preview` (400) |

> النماذج التي أعطت **429** ليست محجوبة — هذه سعة المزوّد المجاني momentary.
> **لم نوسمها `gated`** لأن ذلك سيكون كذباً؛ أعد تشغيل الفحص لاحقاً للتحقق.

#### كيف يُطبَّق هذا في الكود

مصدر حقيقة واحد في `packages/shared/src/catalog/openrouter.ts`:

```ts
export const AGENTIC_HARNESS_GATED: ReadonlySet<string> = new Set([
  'thinkingmachines/inkling:free',
  'thinkingmachines/inkling-small:free',
]);
```

يُطبَّق على **المسارين معاً**: البذور الثابتة **و** التحديث الحيّ `fromOpenRouterApi()`.
بدون هذا كان الكاش الحيّ (456 نموذجاً) يعيد `access:'open'` فيختار الموجه نموذجاً
محجوباً ويرمي 403 للمستخدم — وهذا ما حدث فعلاً وأُصلح. اختباران في `tests/router.test.ts`
يثبّتان هذا السلوك.

---

> **هذه القائمة تتغيّر.** `refreshOpenRouterModels()` يعيد قراءة الكتالوج الحيّ
> (`POST /api/models/refresh`) ويدمجه مع البذور الثابتة، فأي إدخال قديم لا يعطّلك.

---

## المزوّد الصَدى التشخيصي

| الحقل | القيمة |
|---|---|
| المعرّف | `diagnostic:echo` |
| التسمية في الواجهة | **"Diagnostic Echo (NOT an AI model)"** |
| التفعيل | `NOVA_ENABLE_DIAGNOSTIC=true` (معطّل افتراضياً) |
| ما يفعله | يعيد نصّك كما هو + ينفّذ `/tool <name> {json}` بشكل حتمي |
| ما **لا** يفعله | لا يولّد أي محتوى ذكي، ولا يمكن تقديمه كإجابة نموذج |
| في الواجهة | كل ردّ يبدأ بـ `⚠️ DIAGNOSTIC ECHO — this is not an AI model response` + شارة «echo» في الإعدادات |
| الغرض | اختبار البثّ والأدوات والتخزين وحلقة الوكيل **بدون أي مفتاح** |
| حماية | حلقة تكرار تُوقَف عند المرة الرابعة (loop guard) |

---

## المزوّد المخصص (Custom)

أي endpoint يتكلم OpenAI chat-completions API: Ollama · LM Studio · vLLM · Together ·
OpenAI · Anthropic عبر وسيط.

```bash
NOVA_CUSTOM_BASE_URL=http://127.0.0.1:11434/v1
NOVA_CUSTOM_API_KEY=ollama
NOVA_CUSTOM_MODELS=llama3.1,qwen2.5-coder   # اختياري: تقييد المعرّفات
```

> ملاحظة: هذا **لا** يعني تشغيل نماذج محلياً كجزء من NOVA — بل هو سطح تكامل واضح
> مع endpoint أنت تديره وتدفع/تشغّل تكلفته بنفسك.

### إصلاح JSON الدفاعي

بعض النماذج المفتوحة تُخرج استدعاءات أدوات بـ JSON مكسور. سلسلة الإصلاح في
`openai-compatible.ts`:

```
strict parse
  → escapeControlCharsInStrings
  → stripTrailingCommas
  → singleToDoubleQuotes
  → (المصفوفات) { items: [...] }
  → (فشل كامل) { _raw, _parseError }   ← يُمرَّر للوكيل بدل رمي استثناء
```

---

## الفئات الأربع

| الفئة | الاستخدام في NOVA | أمثلة مجانية موصى بها |
|---|---|---|
| `chat` | المحادثة العامة، توليد العناوين | `workers-ai:qwen3.8-27b` · `openrouter:nvidia/nemotron-3.5-lightning:free` |
| `reasoning` | التخطيط، تفكيك المهام المعقدة | `openrouter:nvidia/nemotron-3-ultra-550b-a55b:free` ✅ · `openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` ✅ |
| `coding` | الوكيل البرمجي، توليد الشيفرة | `openrouter:poolside/laguna-s-2.1:free` ✅ · `openrouter:cohere/north-mini-code:free` ✅ · `workers-ai:qwen3.8-27b` |
| `long-context` | فهم مشاريع كاملة، مستندات طويلة | `openrouter:nvidia/nemotron-3.5-super-vl:free` (1M) · `openrouter:nvidia/nemotron-3.5-lightning:free` (1M) |

### تجاوز الافتراضيات

```bash
NOVA_MODEL_CHAT=openrouter:nvidia/nemotron-3.5-lightning:free
NOVA_MODEL_REASONING=openrouter:nvidia/nemotron-3-ultra-550b-a55b:free
NOVA_MODEL_CODING=openrouter:poolside/laguna-s-2.1:free
NOVA_MODEL_LONG_CONTEXT=openrouter:nvidia/nemotron-3.5-super-vl:free
```

أو من الواجهة (تُحفظ في `settings.defaults`) — وإعدادات الواجهة تسبق متغيرات البيئة.

---

## إعادة التحقق بنفسك

```bash
# الكتالوج الحيّ من OpenRouter (لا يحتاج مفتاحاً)
curl -s https://openrouter.ai/api/v1/models | jq '[.data[] | select(.pricing.prompt=="0" and .pricing.completion=="0")] | length'

# حدود الخطة المجانية
# https://developers.cloudflare.com/workers-ai/platform/pricing/

# فهرس نماذج Workers AI
# https://developers.cloudflare.com/workers-ai/models/

# تحديث الكتالوج داخل التطبيق
curl -s -X POST http://127.0.0.1:8787/api/models/refresh | jq '.models | length'

# الأهم: أي نموذج مجاني يعمل فعلاً بمفتاحك؟ (يكشف قيد agentic harness)
npm run probe:openrouter
```

**إن تغيّرت الأسعار أو الحدود، حدّث `packages/shared/src/catalog/*` وعدّل `verifiedAt`.**
هذا هو المكان الوحيد الذي يجب أن يتغيّر — بقية التطبيق لا يعرف شيئاً عن النماذج.

---

## المصادر المُتحقَّق منها (2026-10-30)

| المصدر | ما أُخذ منه |
|---|---|
| `developers.cloudflare.com/workers-ai/platform/pricing/` | 10,000 Neurons/يوم مجاناً، تُصفَّر 00:00 UTC |
| `developers.cloudflare.com/workers-ai/models/` + صفحات النماذج الفردية | 73 نموذجاً مُسح؛ الأسعار، حجم السياق، دعم الأدوات، حالة القفل |
| `openrouter.ai/api/v1/models` (حيّ) | 19 متغيراً مجانياً؛ استُخدمت 16 منها (استُبعدت الصوتية ومصنّفات السلامة) |
| `openrouter.ai/docs/api-reference/limits` | 20 طلب/دقيقة · 50 أو 1000 طلب/يوم · بدون بطاقة |
| `console.groq.com/docs/models` | أغلب نماذج المحادثة مدفوعة/Enterprise → **لم تُضف** |

</div>
