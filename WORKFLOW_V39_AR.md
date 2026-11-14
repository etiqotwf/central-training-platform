# V39 — حماية Google Sheets واستعادة الاتصال

هذا التحديث يعالج مسار تحميل ومزامنة البيانات:

- يفحص وجود أوراق `users` و`courses` و`trainees` و`trainers` و`enrollments` وصحة عناوينها قبل تعديل الذاكرة أو إنشاء أي أوراق جديدة.
- يرفض بدء التشغيل إذا كانت ورقة المستخدمين فارغة، بدل أن يشغّل المنصة على قاعدة ذاكرة فارغة ويعرّض البيانات المستعادة للمسح لاحقًا.
- لا ينفذ `batchClear` قبل كتابة النسخة الجديدة. يكتب البيانات وعداد الصفوف في طلب batch واحد، وبعد نجاحه فقط يحاول تنظيف الصفوف القديمة الزائدة.
- يستخدم ورقة مخفية باسم `_platform_sync_meta` لتحديد عدد الصفوف الفعّالة وتجاهل أي صفوف قديمة متبقية بعد عملية تنظيف فاشلة.
- يمنع مزامنة انخفاض كبير وغير متوقع في عدد السجلات. لا تفعّل `GOOGLE_SHEETS_ALLOW_BULK_DELETE=true` إلا لحذف جماعي مقصود وبعد نسخة احتياطية، ثم أوقفه فورًا.
- يضيف مسارًا تشخيصيًا للمدير: `/api/admin/google-sheets-status`، ولا يعرض مفاتيح أو بيانات اعتماد.
- يدعم بيانات اعتماد حساب الخدمة عبر `GOOGLE_SERVICE_ACCOUNT_JSON` أو `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`، إضافة إلى `GOOGLE_SERVICE_ACCOUNT_FILE`.

## إعداد الاستضافة

استخدم نفس معرّف ملف Google Sheets الذي استعدت منه البيانات:

`GOOGLE_SHEETS_SPREADSHEET_ID=<معرّف ملف Google Sheets المستعاد>`

اختر طريقة واحدة لبيانات اعتماد حساب الخدمة:

### Railway

- أضف متغيرًا سريًا باسم `GOOGLE_SERVICE_ACCOUNT_JSON` وضع فيه محتوى ملف حساب الخدمة JSON كاملًا.
- احذف `GOOGLE_SERVICE_ACCOUNT_FILE` إذا كان يشير إلى مسار جهاز Windows قديم مثل `J:/...`.

أو استخدم `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` مع محتوى الملف بترميز Base64.

### Render مع Secret File

- أنشئ Secret File باسم `google-service-account.json`.
- اضبط `GOOGLE_SERVICE_ACCOUNT_FILE=/etc/secrets/google-service-account.json`.

في الحالتين، شارك ملف Google Sheets المستعاد مع بريد `client_email` داخل حساب الخدمة بصلاحية Editor، واضبط `NODE_ENV=production`.

## مفاتيح الحماية

- لا تضبط `GOOGLE_SHEETS_ALLOW_EMPTY_BOOTSTRAP=true` على ملف يحتوي بيانات حقيقية. هذا الخيار مخصص فقط لإنشاء منصة جديدة على ملف فارغ تمامًا، ثم يجب إيقافه بعد إنشاء المدير.
- اترك `GOOGLE_SHEETS_ALLOW_BULK_DELETE` غير مضبوط أو `false`.
- لا تشغّل سكربت `scripts/export-sqlite-to-sheets.js` على ملف البيانات المستعاد؛ فهو أداة تصدير أحادية الاتجاه وليست أداة استعادة.
- لا ترفع `.env` أو ملف JSON إلى GitHub.

## التحقق بعد النشر

1. راجع Logs. يجب أن تظهر رسالة مثل:
   `[Google Sheets] Loaded and validated N records across M tables.`
   ويجب أن يكون N أكبر من صفر لقاعدة بيانات تحتوي بيانات.
2. سجّل الدخول كمدير وافتح:
   `/api/admin/google-sheets-status`
   يجب أن تكون `configured` و`initialized` قيمتهما `true`، وأن يكون `loadedRecordCount` أكبر من صفر.
3. إذا فشل التحقق من الأوراق أو الحساب، يتوقف الخادم في الإنتاج برسالة واضحة بدل تشغيل ذاكرة فارغة.
4. خذ نسخة احتياطية جديدة من Google Sheets قبل أي تغييرات تشغيلية.

## حدود التوافق

تحديث V39 لا يغيّر بنية جداول SQLite ولا يحذف أوراق Google Sheets. يضيف فقط ورقة مخفية للبيانات الوصفية، وقد يضيف أعمدة أو أوراقًا اختيارية جديدة بعد التأكد من سلامة الأوراق الأساسية. التعديلات اليدوية التي تضيف صفوفًا جديدة مباشرة أسفل النطاق المسجل في Google Sheets metadata لا تُستورد تلقائيًا؛ أضف البيانات من المنصة نفسها حتى تحدّث المنصة metadata بشكل صحيح.

## التوافق مع Central Training Platform

في دمج Central V41 تم الاحتفاظ بتشفير التخزين AES-256-GCM الأصلي وسجل `platform_control.storage_encrypted`. تُفك الخلايا المشفرة عند تحميلها للذاكرة وتُشفّر عند الحفظ، ويظل مفتاح `DATA_ENCRYPTION_KEY` الحالي مطلوبًا إذا كان وضع التشفير مفعّلًا. لا تستبدل المفتاح الموجود عند النشر.
