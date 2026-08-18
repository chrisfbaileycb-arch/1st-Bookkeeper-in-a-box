CREATE TABLE businesses (
 id BIGSERIAL PRIMARY KEY,
 name TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE business_memberships (
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 user_id TEXT NOT NULL,
 email TEXT,
 role TEXT NOT NULL CHECK (role IN ('owner','admin','bookkeeper','approver','viewer')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,user_id)
);
CREATE TABLE chart_of_accounts (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 account_no TEXT NOT NULL,
 name TEXT NOT NULL,
 type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense','cogs')),
 active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (business_id,account_no)
);
CREATE TABLE vendors (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (business_id,normalized_name)
);
CREATE TABLE source_documents (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 original_filename TEXT NOT NULL,
 content_type TEXT NOT NULL,
 file_size BIGINT NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL,
 extraction_status TEXT NOT NULL DEFAULT 'pending',
 extraction_result JSONB,
 uploaded_by TEXT NOT NULL,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE import_batches (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 source_type TEXT NOT NULL,
 original_filename TEXT,
 row_count INT NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'processing',
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE staged_transactions (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 source_document_id BIGINT REFERENCES source_documents(id),
 import_batch_id BIGINT REFERENCES import_batches(id),
 vendor_id BIGINT REFERENCES vendors(id),
 transaction_date DATE NOT NULL,
 amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
 currency CHAR(3) NOT NULL DEFAULT 'USD',
 proposed_account_id BIGINT REFERENCES chart_of_accounts(id),
 offset_account_id BIGINT REFERENCES chart_of_accounts(id),
 memo TEXT NOT NULL DEFAULT '',
 ai_confidence NUMERIC(5,2),
 ai_explanation TEXT,
 duplicate_status TEXT NOT NULL DEFAULT 'clear' CHECK (duplicate_status IN ('clear','possible','confirmed')),
 validation_warnings JSONB NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','needs_review','approved','rejected','committed','failed')),
 created_by TEXT NOT NULL,
 approved_by TEXT,
 approved_at TIMESTAMPTZ,
 committed_at TIMESTAMPTZ,
 resulting_ledger_entry_id BIGINT,
 idempotency_key TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (business_id,idempotency_key)
);
CREATE TABLE staged_transaction_lines (
 id BIGSERIAL PRIMARY KEY,
 staged_transaction_id BIGINT NOT NULL REFERENCES staged_transactions(id),
 account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
 debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
 credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
 memo TEXT NOT NULL DEFAULT '',
 CHECK ((debit = 0) <> (credit = 0))
);
CREATE TABLE ledger_entries (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 entry_date DATE NOT NULL,
 memo TEXT NOT NULL,
 source_document_id BIGINT REFERENCES source_documents(id),
 staged_transaction_id BIGINT UNIQUE REFERENCES staged_transactions(id),
 posted_by TEXT NOT NULL,
 posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reversal_of_id BIGINT REFERENCES ledger_entries(id),
 idempotency_key TEXT NOT NULL,
 UNIQUE (business_id,idempotency_key)
);
ALTER TABLE staged_transactions ADD CONSTRAINT staged_result_fk FOREIGN KEY (resulting_ledger_entry_id) REFERENCES ledger_entries(id);
CREATE TABLE ledger_lines (
 id BIGSERIAL PRIMARY KEY,
 ledger_entry_id BIGINT NOT NULL REFERENCES ledger_entries(id),
 account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
 debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
 credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
 memo TEXT NOT NULL DEFAULT '',
 CHECK ((debit = 0) <> (credit = 0))
);
CREATE TABLE approval_events (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 staged_transaction_id BIGINT NOT NULL REFERENCES staged_transactions(id),
 action TEXT NOT NULL CHECK (action IN ('approved','rejected','approval_revoked')),
 actor_id TEXT NOT NULL,
 note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 actor_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 entity_id TEXT,
 before_value JSONB,
 after_value JSONB,
 metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE duplicate_fingerprints (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 fingerprint TEXT NOT NULL,
 staged_transaction_id BIGINT REFERENCES staged_transactions(id),
 ledger_entry_id BIGINT REFERENCES ledger_entries(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (business_id,fingerprint)
);
CREATE TABLE reconciliation_records (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
 period_end DATE NOT NULL,
 statement_balance NUMERIC(14,2) NOT NULL,
 ledger_balance NUMERIC(14,2) NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 reconciled_by TEXT,
 reconciled_at TIMESTAMPTZ
);
CREATE TABLE workflows (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 name TEXT NOT NULL,
 match_rule JSONB NOT NULL DEFAULT '{}',
 action JSONB NOT NULL DEFAULT '{}',
 active BOOLEAN NOT NULL DEFAULT true,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staged_business_status_idx ON staged_transactions(business_id,status);
CREATE INDEX ledger_business_date_idx ON ledger_entries(business_id,entry_date);
CREATE INDEX audit_business_time_idx ON audit_events(business_id,created_at DESC);