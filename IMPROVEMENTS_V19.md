# V19 — Landing page and trainee course-link visibility

- Refreshed the public landing page typography, spacing, contrast, and mobile layout.
- Replaced the BI tile with a designed ILC monogram logo treatment on the landing page and login card.
- Added a more visible ILC watermark on the opening screen and tuned the existing in-app watermark.
- Tightened dashboard topbar, navigation and page-heading spacing.
- Improved trainee-facing test/evaluation enablement parsing to support numeric, boolean, and common string values from Google Sheets.
- Added clearer instructions that applicants must enter a valid email address because access details are sent to that address after approval.

## Important workflow note
The optional applicant document upload has not been wired to durable storage in this version. Before enabling it, choose a persistent destination (preferably Google Drive or another object store) and implement upload, access control, and a download/review control for administrators. Saving uploaded files only to the Render filesystem is not durable on the free instance.
