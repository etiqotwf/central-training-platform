# V23 – Nomination, course visibility, and attachment workflow

- Added `public_registration_enabled` to courses. New courses are public by default; unchecking the option keeps a course in the admin panel but hides it from the public training plan and registration selector.
- Public application submission rejects courses that are not enabled for public registration.
- Added optional application attachment fields and an admin-only download endpoint. To keep the attachment in the existing Google Sheets primary database, the current implementation limits attachments to 30 KB. Larger files need a durable file store such as Google Drive or object storage before the limit can safely be increased.
- Google Sheets initialization now appends newly added database column headers to existing tabs before loading data, so new fields can persist across deployments.
- Approval workflow already creates/links the trainee account, saves the visible credential for admin display, and inserts the enrollment. Resend is not required by this workflow.

## Verification
- `node --check server.js`
- `node --check public/app.js`
- `node --check scripts/live-google-sheets-sync.js`
- `node --check db.js`

No live Render deployment or real Google Sheets account was available for end-to-end testing in this environment. Test with a new sample course and sample application before deploying to production.
