# فصل اتصال أرشيف Central عن مكتبة المعرفة

هذا التحديث يفصل تكاملَي Google Apps Script حتى لا تتكرر أسماء متغيرات Render أو تختلط مجلدات التخزين.

## متغيرات Render النهائية (أربعة فقط)

| Render Key | القيمة المقابلة |
|---|---|
| `ARCHIVE_SCRIPT_URL` | رابط نشر Web App الخاص بسكريبت الأرشيف الحالي |
| `ARCHIVE_BRIDGE_SECRET` | نفس قيمة `PLATFORM_BRIDGE_SECRET` في Script Properties لسكريبت الأرشيف |
| `KNOWLEDGE_SCRIPT_URL` | رابط نشر Web App الخاص بملف `apps-script/KnowledgeLibraryBridge.gs` |
| `KNOWLEDGE_BRIDGE_SECRET` | نفس قيمة `KNOWLEDGE_BRIDGE_SECRET` في Script Properties لسكريبت المكتبة |

بعد نشر هذا التحديث، أضف قيم `ARCHIVE_*` أولاً بنسخ القيم الحالية من `PLATFORM_SCRIPT_URL` و`PLATFORM_BRIDGE_SECRET`. تأكد أن النشر الجديد يعمل، ثم احذف المتغيرين القديمين `PLATFORM_SCRIPT_URL` و`PLATFORM_BRIDGE_SECRET` من Render. لا تحذفهما قبل التأكد من وجود ARCHIVE_* صحيحين.

## مشروع Apps Script للأرشيف (المشروع الموجود بالفعل)

لا يلزم تغيير كود الأرشيف المرسل. احتفظ بأسماء Script Properties الحالية فيه:

- `PLATFORM_BRIDGE_SECRET`: يساوي قيمة Render `ARCHIVE_BRIDGE_SECRET`.
- `PLATFORM_FOLDER_ID`: مجلد الأرشيف `1oUZcQ1QplQ9oRnwi1hcqtzQMqg-heIB0`.

احتفظ برابط النشر الحالي وضعه في Render `ARCHIVE_SCRIPT_URL`.

## مشروع Apps Script لمكتبة المعرفة (مشروع مستقل جديد)

1. افتح Apps Script وأنشئ مشروعًا مستقلًا للمكتبة.
2. انسخ محتوى `apps-script/KnowledgeLibraryBridge.gs` إلى ملف `Code.gs`.
3. في Project Settings > Script Properties أضف:
   - `KNOWLEDGE_BRIDGE_SECRET`: مفتاح عشوائي جديد بطول 32 حرفًا على الأقل.
   - `KNOWLEDGE_FOLDER_ID`: `1RZj8hHu8-Xz7tzqH_lM7QSUmHVhh8B9T`.
4. شغّل `knowledgeAuthorize` مرة واحدة ووافق على صلاحيات Drive.
5. Deploy > New deployment > Web app، اختر Execute as: Me وWho has access: Anyone، ثم Deploy.
6. ضع رابط `/exec` في Render `KNOWLEDGE_SCRIPT_URL`، والمفتاح نفسه في Render `KNOWLEDGE_BRIDGE_SECRET`.

## سلوك الكود بعد التحديث

- `google-bridge.js` يستخدم `ARCHIVE_SCRIPT_URL` و`ARCHIVE_BRIDGE_SECRET` لعمليات الأرشيف والمرفقات وبيانات الدخول والاتصال. ويدعم أسماء `PLATFORM_*` القديمة مؤقتًا أثناء الانتقال.
- `knowledge-bridge.js` يستخدم حصريًا `KNOWLEDGE_SCRIPT_URL` و`KNOWLEDGE_BRIDGE_SECRET` وأفعاله `knowledgeUpload` و`knowledgeDownload`.
- النسخ الجديدة لمستندات مكتبة المعرفة تحفظ بعلامة `knowledge-drive:` وتُنزل من سكريبت المكتبة.
- السجلات القديمة بعلامة `drive:` تظل قابلة للتنزيل عبر جسر الأرشيف القديم.
- في وضع الإنتاج، رفع مستندات مكتبة المعرفة يتطلب جسر المكتبة المخصص؛ لا يجري تحويلها تلقائيًا إلى مجلد الأرشيف أو إلى حساب الخدمة. يمكن لحساب الخدمة أن يبقى مستخدمًا لتنزيل السجلات القديمة ذات البادئة `drive-sa:`.
- يظل `ARCHIVE_DRIVE_FOLDER_ID` و`GOOGLE_SERVICE_ACCOUNT_FILE` كما هما لصفحة استعراض الأرشيف الحالية. اجعل `ARCHIVE_DRIVE_FOLDER_ID` مساويًا لمجلد الأرشيف `1oUZcQ1QplQ9oRnwi1hcqtzQMqg-heIB0` إن لم يكن مضبوطًا بالفعل. لا تحذف أو تغيّر `GOOGLE_SHEETS_SPREADSHEET_ID` أو `DATA_ENCRYPTION_KEY` أو مفاتيح Supabase.
- اتصال مكتبة المعرفة عبر Apps Script محدود بـ 8 MB للملف الواحد. ملف القانون المرسل سابقًا أصغر من ذلك.

## أمان

استخدم مفتاحين مختلفين؛ مفتاح أرشيف ومفتاح مكتبة. لا تضع المفاتيح في GitHub أو في ملفات المشروع. لا تشارك صورًا تعرض القيم السرية.
