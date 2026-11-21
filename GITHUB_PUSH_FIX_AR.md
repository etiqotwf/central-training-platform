# إصلاح رفض GitHub بسبب مفاتيح Supabase

النسخة الحالية لا تحتوي على الملف `migrate-facebook-storage.js` الذي أبلغ GitHub أنه يحتوي على مفاتيح Supabase. كما أن `.gitignore` يستثني هذا الملف وملفات الإعداد المحلية.

## مهم قبل الرفع
1. إذا كان مفتاح Supabase الحقيقي قد ظهر في Commit سابق، ألغِ المفتاح القديم من لوحة Supabase وأنشئ مفتاحاً جديداً.
2. لا تضع المفتاح الجديد داخل ملفات JavaScript أو داخل Git.
3. احتفظ بالملف `migrate-facebook-storage.js` محلياً إذا كنت تحتاجه للتشغيل، لكن لا ترفعه إلى GitHub. يجب أن يقرأ المفاتيح من متغيرات البيئة.

## أوامر PowerShell داخل مجلد المشروع

```powershell
# أزل ملف الترحيل من تتبع Git فقط، مع الاحتفاظ به على جهازك إن كان موجوداً
git rm --cached --ignore-unmatch migrate-facebook-storage.js

# أزل ملفات الإعداد المحلية من تتبع Git فقط إن كانت متتبعة
git rm --cached --ignore-unmatch local-worker/local-worker-config.json
git rm -r --cached --ignore-unmatch local-worker/.worker-state
git rm --cached --ignore-unmatch local-worker/worker-old-backup.txt

# أعد إنشاء آخر Commit بعد التأكد من أن الأسرار غير موجودة فيه
git add -A
git commit --amend --no-edit

# ارفع التغييرات
git push -u origin main --force-with-lease
```

## فحص قبل الرفع

```powershell
git status --short
git check-ignore -v migrate-facebook-storage.js
git grep -n -I -E "sb_secret_|service_role" HEAD
```

- الأمر الأخير يجب ألا يعرض أي مفاتيح.
- إذا استمر GitHub في اكتشاف سر، لا تستخدم رابط تجاوز الحماية؛ افحص المسار والـ Commit اللذين يذكرهما GitHub، وألغِ المفتاح المكشوف من مزود الخدمة.
- ملف `.env.example` مخصص لأسماء المتغيرات وقيم توضيحية فقط، ولا تضع فيه قيماً حقيقية.
