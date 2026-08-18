CREATE TABLE copilot_runs (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL REFERENCES businesses(id),
 location_id BIGINT NOT NULL REFERENCES locations(id),
 user_id TEXT NOT NULL,
 prompt TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','cancelled')),
 current_step INT NOT NULL DEFAULT 0,
 total_steps INT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ
);
CREATE TABLE copilot_run_steps (
 id BIGSERIAL PRIMARY KEY,
 run_id BIGINT NOT NULL REFERENCES copilot_runs(id),
 position INT NOT NULL,
 module TEXT NOT NULL,
 title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','skipped')),
 result JSONB,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 UNIQUE(run_id,position)
);
ALTER TABLE staged_transactions ADD COLUMN copilot_run_id BIGINT REFERENCES copilot_runs(id);
CREATE INDEX copilot_runs_scope_idx ON copilot_runs(business_id,location_id,created_at DESC);
CREATE INDEX staged_copilot_run_idx ON staged_transactions(copilot_run_id);