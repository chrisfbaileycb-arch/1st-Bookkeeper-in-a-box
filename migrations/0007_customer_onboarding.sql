CREATE TABLE customer_onboarding (
 id BIGSERIAL PRIMARY KEY,
 business_id BIGINT NOT NULL UNIQUE REFERENCES businesses(id),
 user_id TEXT NOT NULL,
 plan TEXT NOT NULL DEFAULT 'founding_249',
 payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN('pending','paid','legacy_owner','past_due','cancelled')),
 business_name TEXT,
 industry_profile TEXT,
 location_name TEXT,
 data_source TEXT CHECK(data_source IS NULL OR data_source IN('bank','csv')),
 bank_status TEXT NOT NULL DEFAULT 'not_started' CHECK(bank_status IN('not_started','connected','skipped')),
 current_step INT NOT NULL DEFAULT 1,
 onboarding_complete BOOLEAN NOT NULL DEFAULT false,
 last_agent_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_onboarding_user_idx ON customer_onboarding(user_id,updated_at DESC);
INSERT INTO customer_onboarding(business_id,user_id,plan,payment_status,business_name,location_name,data_source,bank_status,current_step,onboarding_complete,last_agent_message)
SELECT b.id,b.created_by,'founding_249','legacy_owner',b.name,COALESCE((SELECT name FROM locations WHERE business_id=b.id ORDER BY id LIMIT 1),'Main Location'),'csv','skipped',5,true,'Welcome back. Your existing workspace is ready.'
FROM businesses b
ON CONFLICT(business_id) DO NOTHING;