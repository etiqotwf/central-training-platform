# V21 updates

- Landing-page ILC watermark is centered inside the green information panel, behind foreground text.
- Increased visibility of internal page watermarks while keeping content readable.
- Added a trainer search field using the same live client-side filtering pattern as trainee search.
- Reduced page navigation wait time by loading dashboard, people, application, and optional page data concurrently with `Promise.all`.
- Approval workflow now generates a compact username based on the applicant's name and a random password meeting the existing 12-character minimum and including uppercase/lowercase/digit/symbol characters. Password is bcrypt-hashed before storage; plaintext is never written to Sheets/database.
- Sends credentials through Resend when `RESEND_API_KEY` and `MAIL_FROM` are configured. The approval endpoint refuses to create a new account without mail configuration, to avoid creating an account whose generated password cannot be delivered.

## Email setup before approving new applicants

1. Create/configure a Resend account and verify the sending domain/address.
2. In Render Environment, add `RESEND_API_KEY` and `MAIL_FROM` (for example `Central Training Administration <noreply@your-verified-domain.com>`).
3. Keep the API key secret; do not put it in source control or Google Sheets.
4. Deploy and test with an email address you control before approving real applicants.

The mail API call uses Node's built-in `fetch`; no extra runtime dependency is required. JavaScript syntax was checked with `node --check` for `server.js` and `public/app.js`. A live SMTP/email delivery test requires your Resend credentials and has not been performed here.
