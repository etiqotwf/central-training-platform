# Google Sheets migration — Phase 1 (non-destructive export)

This phase exports a SQLite database snapshot to Google Sheets. It does **not** make Google Sheets the live database and must not be described as a completed migration.

## Before running
1. Make a backup of `training.sqlite` and keep the current Render deployment unchanged.
2. Ensure the target spreadsheet is shared as Editor with the service account email.
3. Keep the service-account JSON out of GitHub and never paste its contents into chat.
4. Set `GOOGLE_SHEETS_SPREADSHEET_ID` to the target spreadsheet ID.
5. Set `GOOGLE_SERVICE_ACCOUNT_FILE` to the key-file path. On Render Secret Files, use `/etc/secrets/google-service-account.json`.
6. Set `SQLITE_FILE` to the exact database file path, or set `DATA_DIR` to its parent folder.

## Run locally
Install dependencies with `npm install`, then run:

`node scripts/export-sqlite-to-sheets.js`

The script creates missing tabs named after the SQLite tables, then replaces the contents of those tabs with a snapshot. Run it only when you intend to replace the target tabs with that database snapshot. It reads SQLite in read-only mode and does not alter the database.

## Important limitations
- This is a one-time export, not live read/write integration.
- The app continues to use SQLite until the server's SQL-based data access is deliberately refactored and tested.
- Password hashes are included because the `users` table is included. Restrict spreadsheet access to trusted administrators only.
- Uploaded files themselves are not copied; only file metadata is exported. Files need separate persistent/object storage.
- Google Sheets does not provide SQLite transactions or foreign-key constraints. A full live migration requires redesigning and testing multi-table operations, concurrency, startup/restore behavior, and sessions.

## تحديث تغييرات Google Sheets الخارجية

Google Sheets هو مصدر البيانات الأساسي. يحتفظ الخادم بنسخة SQLite داخل الذاكرة للاستعلامات فقط، ويعيد تحميل الجداول من Google Sheets دوريًا؛ لذلك فإن حذف صف دورة أو تعديله مباشرة في تبويب `courses` يظهر في المنصة خلال نحو 5 ثوانٍ. يمكن تغيير الفترة عبر `GOOGLE_SHEETS_REFRESH_INTERVAL_MS` (الحد الأدنى 3000 مللي ثانية). أثناء وجود تغييرات محلية لم تُحفظ بعد، يتوقف التحديث الدوري مؤقتًا حتى لا تُستبدل التغييرات الجديدة ببيانات قديمة.
