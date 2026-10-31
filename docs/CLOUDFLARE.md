# النشر المجاني على Cloudflare Workers (`$0` بدون بطاقة بنكية)

تم تجهيز المشروع ليعمل بالكامل على الخطة المجانية في **Cloudflare Workers** بدون الحاجة لبطاقة ائتمانية (تم استبدال اشتراط R2 بتخزين تلقائي داخل قاعدة بيانات **D1 SQLite** المجانية بحجم 5 جيجابايت، مع تفعيل **Workers AI** المجاني لتوليد الصور والمحادثة).

## الطريقة 1: النشر السحابي من GitHub (صفر استهلاك للابتوبك — موصى بها)
1. سجّل حساباً مجانياً في [Cloudflare](https://dash.cloudflare.com/sign-up).
2. افتح صفحة **Workers & Pages** مرة واحدة لاختيار اسم النطاق الفرعي المجاني الخاص بك (`*.workers.dev`).
3. افتح [API Tokens](https://dash.cloudflare.com/profile/api-tokens) ← اضغط **Create Token** ← اختر قالب **Edit Cloudflare Workers**، وأضف صلاحية **Account → D1 → Edit**، ثم انسخ الرمز.
4. ادخل إلى مستودعك في GitHub ← **Settings → Secrets and variables → Actions → New repository secret** وأضف:
   - `CLOUDFLARE_API_TOKEN`: الرمز الذي نسخته من Cloudflare.
   - `NOVA_ACCESS_TOKEN` *(اختياري ومهم للخصوصية)*: كلمة مرور من اختيارك لحماية رابط موقعك.
   - `OPENROUTER_API_KEY` *(اختياري)*: مفتاح OpenRouter المجاني الخاص بك.
5. افتح تبويب **Actions** في GitHub ← اختر **deploy-cloudflare** ← اضغط **Run workflow**.
6. خلال دقيقة واحدة سيظهر لك في الملخص رابط موقعك الجاهز (مثال: `https://nova-ai-cloud.yourname.workers.dev`) لتفتحه من المتصفح أو الجوال فوراً!

## الطريقة 2: بضغطة زر واحدة من جهازك
- اضغط مرتين على الملف `deploy-cloudflare.bat` (أو شغّل `npm run deploy:cloudflare`).
- سيفتح المتصفح لتسجيل الدخول إلى Cloudflare، ثم ينشئ قاعدة البيانات ويرفع الموقع ويعطيك الرابط تلقائياً.
