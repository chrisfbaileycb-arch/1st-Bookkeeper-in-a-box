CREATE OR REPLACE FUNCTION commit_staged_transaction(p_stage BIGINT,p_business BIGINT,p_actor TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE s staged_transactions%ROWTYPE; eid BIGINT; d numeric; c numeric;
BEGIN
 SELECT * INTO s FROM staged_transactions WHERE id=p_stage AND business_id=p_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staged transaction not found'; END IF;
 IF s.status='committed' THEN RETURN s.resulting_ledger_entry_id; END IF;
 IF s.status<>'approved' OR s.duplicate_status<>'clear' THEN RAISE EXCEPTION 'Only approved, non-duplicate items may post'; END IF;
 SELECT COALESCE(sum(debit),0),COALESCE(sum(credit),0) INTO d,c FROM staged_transaction_lines WHERE staged_transaction_id=p_stage;
 IF d=0 OR d<>c THEN RAISE EXCEPTION 'Unbalanced staged transaction'; END IF;
 INSERT INTO ledger_entries(business_id,location_id,entry_date,memo,source_document_id,staged_transaction_id,posted_by,idempotency_key)
 VALUES(p_business,s.location_id,s.transaction_date,s.memo,s.source_document_id,s.id,p_actor,'stage:'||s.id) RETURNING id INTO eid;
 INSERT INTO ledger_lines(ledger_entry_id,account_id,debit,credit,memo)
 SELECT eid,account_id,debit,credit,memo FROM staged_transaction_lines WHERE staged_transaction_id=p_stage;
 UPDATE staged_transactions SET status='committed',committed_at=now(),resulting_ledger_entry_id=eid,updated_at=now() WHERE id=p_stage;
 INSERT INTO audit_events(business_id,location_id,actor_id,event_type,entity_type,entity_id,after_value)
 VALUES(p_business,s.location_id,p_actor,'ledger_committed','ledger_entry',eid::text,jsonb_build_object('staged_transaction_id',p_stage,'debits',d,'credits',c));
 RETURN eid;
EXCEPTION WHEN unique_violation THEN SELECT id INTO eid FROM ledger_entries WHERE business_id=p_business AND idempotency_key='stage:'||p_stage; RETURN eid;
END $$;