# تحديث جسر Google وواجهة تقدم رفع الملفات والفيديوهات

هذه النسخة تتوافق مع ملف `apps-script/PlatformBridge.gs` المرفق داخل المشروع، وهو النسخة الكاملة التي تحافظ على وظائف الجسر الحالية وتضيف الإجراء `platformCreateUploadSession`.

## ما تغير في المشروع

- يستخدم `google-bridge.js` الإجراء `platformCreateUploadSession` لطلب جلسة رفع مباشرة من Google Drive.
- الملفات الأكبر من 8 MiB تُرفع من Render إلى Google Drive على أجزاء حجم كل جزء 8 MiB باستخدام `Content-Range`؛ لا يمر محتوى الملف الكبير داخل طلب Apps Script المشفر.
- الملفات الصغيرة تستمر في استخدام إجراء `platformUpload` القديم.
- واجهة رفع مواد المكتبة تعرض شريطًا ملونًا وثلاث مراحل: إرسال الملف إلى الخادم، الحفظ في Google Drive، ثم تسجيله في المنصة. ينطبق ذلك على المستندات والفيديوهات من نفس شاشة المكتبة.
- أثناء مرحلة حفظ Google Drive يظهر مؤشر متحرك؛ النسبة الدقيقة المتاحة للمتصفح هي نسبة إرسال الملف إلى Render، ولا يدّعي الشريط معرفة النسبة الداخلية لرفع Drive لأن الخادم لا يرسل تقدم Drive إلى المتصفح في هذا الإصدار.

## إعداد Apps Script

1. افتح مشروع Apps Script المرتبط حاليًا بالمنصة، وخذ نسخة احتياطية من الكود القديم.
2. استبدل محتوى ملف `PlatformBridge.gs` بالكامل بمحتوى الملف الموجود في مجلد `apps-script` بهذه الحزمة. لا تحذف ملفات Apps Script الأخرى ولا تخلط جسر مكتبة المعرفة مع جسر الأرشيف.
3. في Script Properties احتفظ بنفس `PLATFORM_BRIDGE_SECRET` المستخدم في Render، ولا تنشئ مفتاحًا جديدًا. احتفظ بـ `PLATFORM_FOLDER_ID` إذا كان مضبوطًا بالفعل.
4. إذا كان ملف manifest ظاهرًا، استخدم `apps-script/appsscript.json` المرفق أو تأكد من وجود الصلاحيات التالية: Drive، UrlFetch external request، ScriptApp، وإرسال البريد.
5. شغّل `platformAuthorize` مرة واحدة من محرر Apps Script ووافق على الصلاحيات.
6. Deploy > Manage deployments > Edit > New version > Execute as Me > Who has access: Anyone > Deploy.

## إعداد Render

في إعدادات Render، يجب أن يشير `ARCHIVE_SCRIPT_URL` إلى رابط `/exec` الخاص بهذا الجسر، وأن تكون `ARCHIVE_BRIDGE_SECRET` مساوية حرفيًا لقيمة Script Property المسماة `PLATFORM_BRIDGE_SECRET`.

إذا كان إعدادك القديم يستخدم `PLATFORM_SCRIPT_URL` و`PLATFORM_BRIDGE_SECRET` بدل `ARCHIVE_*`، فالكود ما زال يدعم الاسمين القديمين. لا تحذف أو تغيّر أي متغيرات أخرى في Render. لا تضع رابط جلسة الرفع أو مفاتيح السر في المتصفح أو السجلات.

## حدود الرفع في هذا الإصدار

- المستندات والمواد: حتى 50 MiB حسب تحقق الخادم.
- الفيديوهات: حتى 100 MiB حسب تحقق الخادم.
- جلسة Google Drive تقبل حتى 100 MiB، والرفع المجزأ يتم من Render مباشرة إلى Drive.
- تنزيل `platformDownload` عبر Apps Script القديم يظل محدودًا بـ 8 MiB؛ مسار مشاهدة الفيديو في المنصة يستخدم مسار التخزين/البث الخاص به ولا يغيّر هذا الحد.

## الاختبار الذي أجري على الحزمة

تم فحص الصياغة باستخدام `node --check` لملفات `server.js` و`google-bridge.js` و`public/app.js`، كما تم فحص تحميلها البرمجي. لم يتم تنفيذ رفع فعلي إلى حساب Google Drive أو النشر على Render من هذه البيئة.
