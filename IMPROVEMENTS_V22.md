# V22 changes
- Removed Resend as a dependency for application approval; approval creates the account without attempting email delivery.
- Added admin-only `password_display` for trainee credentials so generated passwords can be seen/edited in the trainee editor. Password hashes remain in place for authentication.
- The trainee admin API returns username and display password only to admins.
- Editing trainee credentials updates both the password hash and the displayed password; old accounts with no recoverable password can be assigned a new one from the edit dialog.
- Reduced the ILC wordmark watermark size and placed it behind the hero copy within the green landing panel.

## Security note
`password_display` is stored as recoverable plaintext in the Google Sheets-backed `users` table, as requested. This is less secure than storing only password hashes. Restrict access to the spreadsheet and admin account; preferably migrate to a reset-password workflow later.
