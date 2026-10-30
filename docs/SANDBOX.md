# SANDBOX — تنفيذ الشيفرة بأمان

<div dir="rtl">

## القاعدة الأساسية

> **لا يُنفَّذ أي أمر أو شيفرة داخل Worker الخاص بالـ API — أبداً.**

السبب بسيط: ذلك الـ Worker يحمل مفاتيح D1 و R2 ومفاتيح مزوّدي النماذج.
لو نفّذنا `run_command` فيه، فأي أمر واحد سيئ يمكنه قراءة الأسرار.
لذلك التنفيذ **مُفوَّض دائماً** إلى مُهيّئ (adapter) خارجي، والافتراضي هو **معطّل**.

---

## الأوضاع الثلاثة

| الوضع | `NOVA_SANDBOX` | اللغات | نظام الملفات | الشبكة | مستوى العزل |
|---|---|---|---|---|---|
| **معطّل** (الافتراضي) | `disabled` | — | — | — | لا شيء — يُعيد خطأً صريحاً |
| **Worker معزول** | `worker` | JavaScript فقط | ❌ | ❌ | ✅ V8 isolate حقيقي بدون أي bindings |
| **خدمة خارجية** | `http` | `shell` · `javascript` · `typescript` · `python` | ✅ (mount للقراءة) | ⚠️ حسب مزوّدك | ⚠️ **مسؤوليتك أنت** |

### `disabled` — fail-closed

هذا هو الافتراضي في `.dev.vars`. عند استدعاء أداة `run_command` أو `verify_code`:

```json
{ "ok": false, "error": "sandbox not configured", "adapter": "disabled" }
```

**لا تزييف، لا تنفيذ جزئي، لا صمت.** المستخدم يعرف فوراً أن الـ Sandbox غير مُعَد.

### `worker` — عزل حقيقي، قدرات محدودة

`sandbox/worker/` هو Worker مستقل **بدون أي bindings إطلاقاً** (لا D1، لا R2، لا AI، لا fetch خارجي).
يستقبل الشيفرة، ينفّذها داخل isolate، ويعيد النتيجة. يعمل عبر **service binding**
(لا يمر بالشبكة العامة).

القيود المقصودة:
- JavaScript فقط — لا Python، لا shell.
- لا وصول لنظام الملفات.
- لا وصول للشبكة.

هذا مناسب لتشغيل حسابات، تحويلات JSON، واختبار منطق — وليس لبناء مشروع.

### `http` — عقد مفتوح لأي مزوّد

أي خدمة تنفّذ العقد التالي تعمل مع NOVA: حاوية Docker، Firecracker، gVisor،
E2B، Modal، Fly Machines، أو خادم مرجعي محلي.

---

## العقد (Contract)

### الطلب

```http
POST {NOVA_SANDBOX_URL}/exec
Authorization: Bearer {NOVA_SANDBOX_TOKEN}
Content-Type: application/json
```

```json
{
  "command": "python3 main.py",
  "code": "print(1+1)",
  "language": "shell | javascript | typescript | python",
  "projectId": "prj_abc123",
  "timeoutMs": 20000,
  "files": { "src/main.py": "print('hi')", "package.json": "{...}" }
}
```

- `command` **أو** `code` — أحدهما يكفي.
- `files` تُركَّب **للقراءة فقط** داخل مساحة عمل Sandbox.
- `timeoutMs` افتراضيه 20000 ويُحدَّد بسقف من جهة NOVA.

### الاستجابة

```json
{
  "ok": true,
  "stdout": "hi\n",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 42,
  "truncated": false,
  "adapter": "http:http://127.0.0.1:8790"
}
```

- `adapter` **إلزامي** — يخبر الواجهة بمن نفّذ الأمر فعلياً، لتعرض مستوى العزل بصدق.
- `truncated` تُضبَط `true` عند تجاوز حدّ المخرجات.
- عند الفشل: `ok:false` مع `error` يشرح السبب (مهلة، لغة غير مدعومة، خطأ تنفيذ...).

### فحص الصحة

```http
GET {NOVA_SANDBOX_URL}/health      →  200 { "ok": true }
```

---

## سياسة الأوامر

`classifyCommand()` في `apps/worker/src/agent/permissions.ts` — قائمة صريحة ومحافظة،
بدون تحليل ذكي قابل للتلاعب.

### 🔴 محظور (`blocked` → HTTP 400 `command_blocked`)

| القاعدة | النمط |
|---|---|
| `rm-recursive` | `rm -rf` وكل صيغ الحذف المتكرر |
| `disk-destroy` | `mkfs` · `dd if=… of=/dev/…` |
| `pipe-to-shell` | `curl … \| sh` · `wget … \| bash` |
| `host-control` | `shutdown` · `reboot` · `halt` · `poweroff` |
| `chmod-777` | `chmod 777` (و`-R 777`) |
| `fork-bomb` | `:(){ :\|:& };:` |
| `empty` / `too-long` | أمر فارغ أو أطول من 4000 حرف |

### 🟡 يحتاج موافقة (`needs-approval`)

| القاعدة | النمط |
|---|---|
| `force-push` | `git push --force` / `-f` |
| `npm-publish` | `npm publish` / `unpublish` |
| `git-reset-hard` | `git reset --hard` |
| `privilege-escalation` | `sudo` · `su` |
| `network` | `curl` · `wget` · `nc` · `ncat` · `ssh` · `scp` |
| `install-deps` | `npm/pnpm/yarn install/i/add/ci` |

### 🟢 آمن (`safe`)

أي أمر لا يطابق قاعدة أعلاه (مثل `ls` · `cat` · `python3 main.py` · `pytest`).

### طبقتا الدفاع

السياسة تُطبَّق في **مكانين مستقلين**:

1. داخل أداة الوكيل `run_command` → تُعيد `fail(...)` مع اسم القاعدة.
2. على مسار `POST /api/sandbox/exec` المباشر → `400 command_blocked`.

فلا يمكن تجاوزها باستدعاء المسار مباشرةً.

---

## تصنيف خطورة الأدوات

| الخطورة | الأدوات | السلوك |
|---|---|---|
| `read-only` | `read_file` · `list_files` · `search_project` · `git_status` · `git_diff` · `git_log` · `verify_code` · `read_memory` | تُنفَّذ بدون توقّف |
| `proposal` | `write_file` · `edit_file` · `delete_file` · `write_memory` · `plan_tasks` · `update_task` | تنشئ **تغييراً معلّقاً** ينتظر موافقتك |
| `needs-approval` | `run_command` · `git_commit` | تتطلب إذناً صريحاً |

الطرفية نفسها تتطلب **`allowTerminal` لكل تشغيل** — لا يستطيع الوكيل تفعيلها لنفسه.

---

## التشغيل

### الخادم المرجعي (للتطوير والاختبار فقط)

```bash
node scripts/sandbox-reference-server.mjs   # المنفذ 8790
```

يدعم: `shell` · `javascript` · `typescript` · `python`، تركيب ملفات، مصادقة Bearer،
و**قتل مجموعة العمليات كاملة** عند انتهاء المهلة.

ثم في `apps/worker/.dev.vars`:

```bash
NOVA_SANDBOX=http
NOVA_SANDBOX_URL=http://127.0.0.1:8790
NOVA_SANDBOX_TOKEN=dev-token
NOVA_SANDBOX_TIMEOUT_MS=20000
```

> ⚠️ **أعد تشغيل عملية `wrangler dev` بالكامل** — إعادة التحميل الساخن **لا** تقرأ
> `.dev.vars` من جديد. (تم التحقق من هذا مرتين.)

### الفحص الذاتي

```bash
npm run sandbox:selftest        # 10 فحوصات — كلها تنجح
```

يغطي: الصحة · المصادقة · shell · javascript · typescript · python ·
انتهاء المهلة · قتل مجموعة العمليات · تركيب الملفات · الأوامر المحظورة.

### وضع Worker المعزول

```bash
# الخيار أ: Worker معزول عبر service binding (JS فقط)
npm run dev:sandbox-worker   # sandbox Worker على 8788
NOVA_SANDBOX=worker

# الخيار ب: خدمة خارجية عبر العقد
npm run dev:sandbox          # الخادم المرجعي على 8790 (بدون عزل!)
NOVA_SANDBOX=http
```

---

## ⚠️ تحذير أمني مهم

> **`scripts/sandbox-reference-server.mjs` لا يوفّر أي عزل من تلقاء نفسه.**
>
> هو **تنفيذ مرجعي للعقد** — يعرض لافتة تحذير عند الإقلاع. يشغّل الأوامر فعلياً
> في بيئة Node الحالية. لذلك:
>
> - شغّله **داخل حاوية قابلة للتخلّص منها** (Docker بدون mount لمجلدات مهمة، أو Firecracker/gVisor).
> - **لا** تشغّله على جهازك مباشرة بمجلد يحتوي أسراراً.
> - للإنتاج استخدم خدمة sandbox مُدارة حقيقية (E2B، Modal، Fly Machines...) عبر وضع `http`.

---

## حقن مُهيّئ مخصص (للاختبارات)

`bootstrap()` يقبل حقن `sandbox` اختياري:

```ts
const app = createApp(bootstrap({ sandbox: myFakeAdapter }));
```

هذا ما تستخدمه الاختبارات (37 اختبار وكيل + 6 اختبارات لمسار الـ Sandbox)
لتحقيق تغطية كاملة بدون تنفيذ حقيقي.

---

## أمثلة curl

```bash
# الحالة
curl -s http://127.0.0.1:8787/api/sandbox/status | jq
# → { "kind": "http", "ready": true, ... }

# تنفيذ أمر
curl -s -X POST http://127.0.0.1:8787/api/sandbox/exec \
  -H 'content-type: application/json' \
  -d '{"command":"echo hello","language":"shell"}' | jq

# أمر محظور → 400
curl -s -i -X POST http://127.0.0.1:8787/api/sandbox/exec \
  -H 'content-type: application/json' \
  -d '{"command":"rm -rf /","language":"shell"}'
# → HTTP/1.1 400 … { "error": "command_blocked", … }
```

---

## حالات تم التحقق منها طرفاً لطرف

مع `NOVA_SANDBOX=http` والخادم المرجعي على 8790:

| الفحص | النتيجة |
|---|---|
| `GET /api/sandbox/status` | `kind:http` · `ready:true` ✅ |
| تنفيذ مباشر: shell | stdout حقيقي ✅ |
| تنفيذ مباشر: javascript | stdout حقيقي ✅ |
| انتهاء المهلة | يقتل العملية ويعيد `ok:false` ✅ |
| أداة الوكيل `run_command` | تمر عبر الـ Sandbox وتعيد stdout حقيقياً مع ملفات المشروع المركّبة ✅ |
| اسم المُهيّئ المُبلَّغ | `http:http://127.0.0.1` ✅ |
| أمر محظور (أداة + مسار مباشر) | `400 command_blocked` في الحالتين ✅ |

</div>

---

## English summary

Code execution is **never** performed inside the API Worker (it holds D1/R2/provider secrets).
Three adapters exist:

- **`disabled`** (default, fail-closed) — returns an explicit "not configured" error; never fakes output.
- **`worker`** — a separate Worker with **zero bindings** (no D1/R2/AI/network), reached via service binding. JavaScript only.
- **`http`** — any external service implementing the contract: `POST {url}/exec` with Bearer auth,
  body `{command?, code?, language?, projectId?, timeoutMs?, files?}`,
  response `{ok, stdout, stderr, exitCode, durationMs, truncated, adapter}`.

A conservative explicit command policy (`classifyCommand`) blocks `rm -rf`, `mkfs`/`dd`,
`curl|sh`, host power commands, `chmod 777`, and fork bombs, and requires approval for
force-push, `npm publish`, `git reset --hard`, `sudo`, network tools, and dependency installs.
**It is enforced at both the agent tool and the direct `/api/sandbox/exec` route.**

The reference server (`scripts/sandbox-reference-server.mjs`) implements the contract but
**provides no isolation itself** — run it in a disposable container. `npm run sandbox:selftest`
runs 10 contract checks (all passing).
