# V33 asynchronous local inference bridge

## Components and identity

Online `ai/queue.js` owns scoped requests, frozen prompts, versioned source references, leases, result validation, candidates, human publication and worker credentials. Standalone `local-worker/worker.cjs` uses only Node built-ins. It never imports the platform database, Sheets adapter, service-account key or server environment file. Ollama requests are loopback-only; platform requests are HTTPS except localhost test setups, with redirects refused to avoid forwarding bearer credentials.

Existing direct provider mode remains available. `ai_settings.execution_mode` overrides `AI_EXECUTION`; auto defaults to queue in production and direct in development. Legacy direct tools are regression-tested; no automatic paid fallback was introduced.

## Persistence

Three additive tables: `ai_workers`, `ai_jobs`, `ai_answer_cards`; additive AI execution-mode column. All business writes use the existing query helper and debounced Google Sheets snapshots. New `flushGoogleSheetsWrites()` waits for a successfully persisted write version before job submission/lease/completion/publication is acknowledged. Transient failures return503; a completion that committed in memory can be retried with the same receipt and will not create another draft. Existing periodic refresh protection and schema-header batching remain in place.

This is still a single-process, single-online-writer application. Full Google Sheets snapshots are not transactional remote database commits. Multi-replica deployments, competing complete app instances or manual concurrent Sheets edits are outside the queue's concurrency guarantee. A standalone worker does not create another writer. For larger traffic, move the persistence/queue to an appropriate transactional store before horizontal scaling; monitor table/cell growth and back up the authoritative sheets.

## Credentials and leases

A worker credential is UUID.random256bitSecret. Only SHA256 of the full token is stored; full token is delivered once through an administrator-created private download. Tokens authorize only claim/heartbeat/complete/fail, never general admin endpoints. Admin-defined course scopes are enforced for claims and receipts. Revocation immediately prevents further authenticated worker calls and releases eligible leased jobs.

Each claim creates a fresh random lease token whose hash is persisted. Five-minute leases renew every30 seconds, at most20 minutes from the current claim start. A worker handles one job at a time; candidates have at most3 attempts. Expiry permits reassignment and invalidates the old token. Canceled requests, stale sources, removed roles and revoked credentials cannot publish results. Browser cookies cannot substitute for the bearer credential.

The worker has a local private outbox saved atomically before completing a job. Network errors retain it; exact duplicate completion digests acknowledge without duplicate writes. Stale/canceled/invalid receipts are discarded. Leases intentionally limit how long a disconnected result can be accepted; this is not an unlimited offline synchronization guarantee. A CLI PID lock discourages duplicate worker processes using the same outbox folder. Private config/outbox files are ignored by git and excluded from distribution.

## Contracts

Prompts are generated server-side only, from authorized course material or aggregate statistics. Workers cannot choose arbitrary sources, SQL, system commands, target users, model endpoints or business-write routes through a job. Payload size and result contracts are bounded for current Sheets cell limits. Worker output is untrusted data; HTML rendering and report fields are escaped. Keys/correct answers remain in staff drafts, never automatically published as learner answer cards.

Question generation creates exactly one existing `ai_drafts` candidate transactionally with completion. Existing admin review publishes it only as a draft official activity; the current publishing flow remains unchanged. Lesson candidates require explicit admin review before insertion into `ai_sources`. Tutor outputs belong to their requester until admin review creates an approved card. Insights persist their original aggregate snapshot and generation time and are not automatically refreshed business facts.

Source fingerprints cover the active source set's IDs/titles/content. Changed source sets prevent claiming or completing stale jobs and prevent serving obsolete cards. Published lessons update their own provenance fingerprint after approved insertion, so publication retries are idempotent. Old result candidates remain available to staff for audit; learner result reads recheck current access and source validity.

## Reuse versus generation

Exact normalized question + instructional mode + current source version may reuse an enabled approved card immediately, without calling the worker or checking Ollama availability. Near matches are searchable cards for deliberate selection, never silently substituted answers. Search/read still enforce enrollment/assigned-course access, role/course settings and active internal-exam guards. Approved cards can be archived by admins without deleting the original request.

Learner history persists in the online queue; the UI explicitly says this differs from ephemeral direct conversations. Staff review access is deliberate. Worker packets omit login credentials, user names and raw individual result tables; user-entered questions/material can still contain personal information and should be authored accordingly. Anonymous aggregate statistics can be identifying in small groups; do not treat aggregation as an unconditional privacy guarantee.

## Operational limits

5 enabled workers maximum, 5 active jobs per requester, configured request/token admission limits,1 in-flight lease per worker,10-second worker polls,15-second browser list refreshes. Idle worker presence writes are throttled to roughly1/minute, while active lease renewals write periodically. Generation timeout is4 minutes per attempt. Retained request/result records can grow; no automatic destructive purge is included. Limit new requests and maintain data retention appropriate to the institute.

No inference host or model weights are included or deployed. The Windows setup installs/downloads locally on user invocation, never exposes a server port publicly, and does not modify existing Google/email config. Model quality, hardware speed, real Render connectivity and the user's real service credentials need a deployment smoke test. Unit/integration and browser tests use a local fake Ollama HTTP contract and mocked Google writes. Algorithmic learning and DRL from V32 are unaffected.

## Relevant files

- `ai/queue.js`: online authority, endpoints and validation.
- `ai/index.js`: shared preparation helpers and async/direct routing.
- `local-worker/worker.cjs`: independent client, heartbeat and private outbox.
- `local-worker/Setup_Local_Worker.ps1`, `Start_Worker.cmd`: user-side startup.
- `public/ai-queue.js`, `public/ai.js`: status, pairing, review and ready answer library.
- `scripts/live-google-sheets-sync.js`: versioned flush acknowledgement on the existing snapshot writer.
- `tests/queue-v33.cjs`, `tests/flush-v33.cjs`: failures, retries and privacy boundaries.

Official inference protocol: https://docs.ollama.com/api/chat
