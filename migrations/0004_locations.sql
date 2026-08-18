CREATE TABLE locations (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 name TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(business_id,name)
);
INSERT INTO locations(business_id,name) SELECT id,'Main Location' FROM businesses ON CONFLICT DO NOTHING;
ALTER TABLE staged_transactions ADD COLUMN location_id BIGINT REFERENCES locations(id);
ALTER TABLE ledger_entries ADD COLUMN location_id BIGINT REFERENCES locations(id);
ALTER TABLE source_documents ADD COLUMN location_id BIGINT REFERENCES locations(id);
ALTER TABLE import_batches ADD COLUMN location_id BIGINT REFERENCES locations(id);
ALTER TABLE audit_events ADD COLUMN location_id BIGINT REFERENCES locations(id);
UPDATE staged_transactions s SET location_id=(SELECT min(id) FROM locations l WHERE l.business_id=s.business_id);
-- Historical ledger entries remain unmodified and are treated as Main Location records.
UPDATE source_documents d SET location_id=(SELECT min(id) FROM locations l WHERE l.business_id=d.business_id);
UPDATE import_batches b SET location_id=(SELECT min(id) FROM locations l WHERE l.business_id=b.business_id);
-- Historical audit rows remain business-level to preserve append-only integrity.
CREATE INDEX staged_location_status_idx ON staged_transactions(location_id,status);
CREATE INDEX ledger_location_date_idx ON ledger_entries(location_id,entry_date);