# Bookkeeper in a Box on Render

The canonical `app/` application has been adapted from AppDeploy to a standalone Node/Express service. The existing accounting routes and UI remain; platform database/storage/AI imports resolve to a real PostgreSQL adapter, database-backed invoice image storage and Gemini API calls. The old root Hatchable engine is not the deployed entry point.

## Deploy

Use this repository's Render Blueprint (`rootDir: app`). Provide durable `DATABASE_URL`, an initial `OWNER_PASSWORD` (12+ characters), and `GEMINI_API_KEY` for invoice extraction and the assistant. Enter secrets in Render's Environment settings, not source control or chat.

Build: `npm ci --include=dev && npm run build`. Start: `npm start`. Node 24 is required. The owner password is hashed at first startup; later deployments preserve the existing password. Change it inside the authenticated app. Production refuses to start without persistent storage or a configured owner. `/health` queries the database.

Every accounting request uses a database transaction and a database advisory lock. Duplicate posting and setup are serialized across instances; failed requests roll back their database writes. Uploaded invoice images are saved in PostgreSQL, not Render's temporary filesystem. The current global accounting lock favors consistency for a small preview deployment; sustained concurrent load requires performance review.

## Existing Hatchable records and tenancy

The current Hatchable database contains three businesses, three locations, two posted ledger entries (four lines) and two staged transactions (three lines), plus approvals and audit records. A complete recovery export is kept outside the repository. None of those records has been imported or converted yet.

The canonical AppDeploy application is single-tenant: one deployment serves one business, with multiple locations. Hatchable's rebuild supports separate businesses and membership roles. Do not merge those businesses into a single location list or mix their financial records. Before production cutover, either run a separate instance per business or implement and verify business/role isolation. Staged records must remain drafts until human approval; they must not be turned into posted journals by an importer. This is a remaining migration dependency, not a completed data transfer.

No financial backup or real customer data is committed with this branch. Do not delete or modify the old ledger during staging.

## Verification

`npm test` runs 18 existing authentication/accounting tests plus a real HTTP/database runtime test. The latter verifies owner bootstrap, unauthorized rejection, duplicate-write protection, balanced journal lines, an audit entry, persisted login and journal after server restart, and wrong-password rejection. The production frontend builds successfully. Hosted PostgreSQL and actual Gemini calls await secure settings.
