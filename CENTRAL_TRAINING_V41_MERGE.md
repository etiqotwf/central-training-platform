# Central Training Platform — V41 integration package

## Correct project direction

- **Target/base:** Central Training Platform (`central-training-platform-main.zip`).
- **Feature source:** British Institute Tanta (`british-institute-tanta-main.zip`).
- This package is an additive integration into Central. It is not a replacement with the British application.

## Central features deliberately preserved

The integration retains the Central application's existing identity, master-control unlock and permission routes, platform-control tables, AES-256-GCM storage-encryption behavior, intelligence/reporting modules, course archive, Central Google Sheets target ID, Apps Script bridge settings, existing authentication/session code, existing learning and reporting routes, and the existing logo/branding.

The new course workflow is loaded as a separate `public/course-workflow.js` module after Central's existing `public/app.js`; the Central application shell was extended rather than replaced. Central's existing `db.js` and learning archive module were not replaced.

## Features integrated from the British source

- Rule-based training-program generator based on source material, session count, and planned hours. It runs locally with deterministic rules; it does **not** call a generative AI model.
- Per-course / per-session workflow for generated learning objectives, activities, assignments, and quizzes.
- Learner-facing direct wording for task, assignment, and quiz prompts.
- Progressive difficulty and dynamic quiz item counts (2/3/5 based on progression rules).
- Separate pending, approved, and discarded views in the course workflow board.
- Approval and discard actions; approved items remain visible in the approved view and are exposed to enrolled learners, while pending book-generated content remains hidden.
- Course-specific enrollment removal that removes only the enrollment record, not the trainee or their other course registrations.
- Upload handling raised to 50 MB in the application routes and UI; PDF extraction capped at 300 pages and 500,000 extracted characters. Image-only/scanned PDFs still need OCR or a searchable/text-based source.
- Trainee-facing session responses use a learner-safe field projection and do not expose instructor notes.
- V39-style Google Sheets safety: validate core tabs and user rows before import, reject unexpected empty/large-shrink snapshots, write a complete new snapshot before any optional tail-row cleanup, and report sync/initialization status.
- Central's existing AES-256-GCM-at-rest storage encryption is integrated into the Google Sheets sync path. The `enc:v1:` cell format is retained. Existing `DATA_ENCRYPTION_KEY` must remain unchanged when encrypted storage is enabled.

## Files added

- `ai/course-planner.js`
- `public/course-workflow.js`
- `WORKFLOW_V37_AR.md`
- `WORKFLOW_V38_AR.md`
- `WORKFLOW_V39_AR.md`
- `WORKFLOW_V41_AR.md`
- `NO_AI_TRAINING_GENERATOR_V35_AR.md`
- `tests/course-workflow-v37.cjs`
- `tests/course-workflow-v38.cjs`
- `tests/sheets-protection-v39.cjs`
- `tests/central-v41-integration.cjs`
- `tests/central-v41-encryption.cjs`

## Files extended/modified

- `server.js`
- `ai/index.js`
- `ai/queue.js`
- `ai/extract-worker.js`
- `activity-workflow.js`
- `learning/assessments.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `scripts/live-google-sheets-sync.js`
- `package.json`
- `.env.example`
- `local-llm/Modelfile` (organization wording only)

## Important deployment requirements

1. Deploy this package over the **Central Training Platform repository**, not the British repository.
2. Do not overwrite the live `.env`, Google service-account key, local `data/` directory, SQLite files, uploads, or `node_modules/` with files from an archive.
3. Keep the same production `GOOGLE_SHEETS_SPREADSHEET_ID` that contains the recovered Central data. Do not switch to the British spreadsheet ID.
4. Keep the existing `DATA_ENCRYPTION_KEY` exactly unchanged if the Central spreadsheet already contains encrypted cells (`enc:v1:`). A new key will make old values unreadable.
5. Configure one valid Google service account method: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, or `GOOGLE_SERVICE_ACCOUNT_FILE`. Share the recovered Central spreadsheet with that service-account email as Editor.
6. Leave `GOOGLE_SHEETS_ALLOW_EMPTY_BOOTSTRAP=false` and `GOOGLE_SHEETS_ALLOW_BULK_DELETE=false`.
7. Before production deployment, back up the recovered Google spreadsheet and current deployment environment.
8. After deployment, check `/api/admin/google-sheets-status` as an authenticated administrator. Do not enable application writes if Google initialization did not complete or the loaded core-table counts are zero.

## Validation performed in the build workspace

The following checks passed:

- JavaScript syntax checks for changed server, AI, workflow, learner, UI, and Google sync files.
- `tests/course-workflow-v37.cjs`
- `tests/course-workflow-v38.cjs`
- `tests/sheets-protection-v39.cjs`
- `tests/central-v41-integration.cjs`
- `tests/central-v41-encryption.cjs`

The full original project test suite and a live connection to the user's Google account / production host were not run in this workspace. Run `npm test` in the deployment environment before enabling production traffic.

## Upload size note

The primary Central app's Express upload routes and UI use the integrated 50 MB application limit. The legacy Google Apps Script bridge source still contains its own 8 MB Drive-file transfer limits. Those bridge limits were intentionally left unchanged to avoid modifying a separate existing integration without testing its deployed Apps Script counterpart.
