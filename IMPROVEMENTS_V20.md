# V20 updates

- Public landing hero headline forced to white with stronger contrast.
- Oversized centered ILC watermark on the dark hero panel, responsive for mobile.
- Added a searchable trainees table (name, phone, email, department, username where available).
- JavaScript syntax checked with `node --check`.

## Automated account creation and email delivery

Not enabled in this package yet. It requires SMTP provider credentials to be configured securely in the hosting environment (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). The password should be generated randomly, stored only as a bcrypt hash, and delivered once by email; do not persist plaintext passwords in the trainees list or Google Sheets. The admin list can show the username and account/email delivery status, with password reset instead of exposing stored passwords.
