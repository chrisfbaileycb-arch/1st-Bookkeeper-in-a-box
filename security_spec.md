# Security Specification — 1st Bookkeeper-In-A-Box Firestore Rules

## 1. Data Invariants
1. All client write operations must be authenticated.
2. System-only and audit collections (`audit_log`) are append-only; updates and deletions are strictly forbidden.
3. Journal entries are immutable double-entry records: once posted, updates and deletions are prohibited; corrections must be made via new linked entries (`VOID`, `REV`, `CORR`).
4. Location isolation: documents belonging to a location require valid location IDs matching `^[a-zA-Z0-9_\-]+$`.
5. String inputs must have strict length bounds (preventing resource exhaustion / denial of wallet attacks).
6. Document IDs must adhere to standard alphanumeric and safe character format.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: An unauthenticated user attempts to create a location.
2. **Audit Log Tampering**: An authenticated user attempts to update or delete an `audit_log` entry.
3. **Journal Entry Mutation**: An authenticated user attempts to modify line amounts in an existing `journal_entries` record.
4. **ID Poisoning Attack**: An attacker attempts to write with a 2KB junk character ID.
5. **Shadow Field Injection**: A payload containing unexpected ghost fields (e.g. `isAdmin: true` or `shadowField: "exploit"`).
6. **Negative Check Amount**: A check record submitted with an invalid or negative amount.
7. **Invalid Date Format**: A journal entry submitted with a non-YYYY-MM-DD date string.
8. **Oversized String Payload**: An invoice description exceeding allowed bounds.
9. **Blanket Query Scraping**: Attempting an unrestricted list query without proper auth context.
10. **Session Privilege Escalation**: Attempting to alter session expiry to the far future.
11. **Orphan Location Reference**: Creating a subledger document pointing to a malformed or non-existent location ID.
12. **Status Bypass**: Illegally overriding a cleared check status back to unverified states.

## 3. Rules Verification Plan
Rules will enforce ABAC, default-deny safety net, type checking, field size constraints, and immutable audit logs.
