# V40 — Master Control setup

## 1) Render secret
Add `MASTER_ADMIN_PASSWORD` in Render Environment and set it to the private master-control password chosen by the platform owner. Do not commit this password to GitHub.

`DATA_ENCRYPTION_KEY` must remain configured and unchanged. ENCRYPT/DECRYPT changes only the at-rest representation in Google Sheets; the in-memory platform continues to work normally.

## 2) Contact form / Gmail
The platform contact form sends through the existing signed Apps Script bridge. Update the deployed Apps Script with the V40 `apps-script/PlatformBridge.gs` (or merge the V40 `platformContact` branch from `ExistingScript_Integrated.gs`) and deploy a new Web App version. Keep the existing `PLATFORM_BRIDGE_SECRET` unchanged.

Messages are delivered to `dtctantaformal@gmail.com`; Reply-To is set to the email entered by the platform user.

## 3) Master controls
Only signed-in admins see ENCRYPT/DECRYPT and PERMISSION. Both require master unlock. Unlock lasts 20 minutes in the server session and is rate-limited. The password is verified server-side only.

PERMISSION controls modules for other admins, trainers and trainees. Enforcement is server-side for mapped API modules in addition to navigation hiding.
