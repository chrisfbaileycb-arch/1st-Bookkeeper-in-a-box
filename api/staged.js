import { db } from 'hatchable'; import { membership,cleanText,money,audit } from 'lib/context.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const u=req.user,b=req.body||{},action=b.action;
 try{
  const allowed=action==='commit'?['owner','admin','approver']:action==='approve'||action==='reject'?['owner','admin','approver']:['owner','admin','bookkeeper','approver'];
  const {businessId}=await membership(u.id,b.business_id,allowed);
  const locationId=Number(b.location_id);const loc=(await db.query('SELECT id FROM locations WHERE id=$1 AND business_id=$2 AND active=true',[locationId,businessId])).rows[0];if(!loc)throw new Error('Location access denied');
  if(action==='create'){
   let runId=b.copilot_run_id?Number(b.copilot_run_id):null;if(runId){const run=(await db.query("SELECT id FROM copilot_runs WHERE id=$1 AND business_id=$2 AND location_id=$3 AND user_id=$4 AND status IN('queued','running')",[runId,businessId,locationId,u.id])).rows[0];if(!run)throw new Error('Copilot run access denied')}
   const amount=money(b.amount),date=/^\d{4}-\d{2}-\d{2}$/.test(b.transaction_date||'')?b.transaction_date:new Date().toISOString().slice(0,10);
   const pa=Number(b.proposed_account_id),oa=Number(b.offset_account_id);
   const fp=await crypto.subtle.digest('SHA-256',new TextEncoder().encode([businessId,date,amount,cleanText(b.vendor,120).toLowerCase()].join('|')));
   const hash=Array.from(new Uint8Array(fp)).map(x=>x.toString(16).padStart(2,'0')).join('');
   const dup=await db.query('SELECT 1 FROM duplicate_fingerprints WHERE business_id=$1 AND fingerprint=$2',[businessId,hash]);
   let vendorId=null;if(cleanText(b.vendor,120)){const v=await db.query('INSERT INTO vendors(business_id,name,normalized_name) VALUES($1,$2,$3) ON CONFLICT(business_id,normalized_name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[businessId,cleanText(b.vendor,120),cleanText(b.vendor,120).toLowerCase()]);vendorId=v.rows[0].id}
   const s=await db.query(`INSERT INTO staged_transactions(business_id,location_id,vendor_id,transaction_date,amount,proposed_account_id,offset_account_id,memo,ai_confidence,ai_explanation,duplicate_status,validation_warnings,status,created_by,idempotency_key,copilot_run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[businessId,locationId,vendorId,date,amount,pa,oa,cleanText(b.memo),b.ai_confidence??null,cleanText(b.ai_explanation,1000),dup.rows.length?'possible':'clear',JSON.stringify((pa&&oa)?[]:['Two accounts are required']),dup.rows.length?'needs_review':'pending',u.id,hash,runId]);
   const id=s.rows[0].id;if(pa&&oa)await db.transaction([{sql:'INSERT INTO staged_transaction_lines(staged_transaction_id,account_id,debit,memo) VALUES($1,$2,$3,$4)',params:[id,pa,amount,cleanText(b.memo)]},{sql:'INSERT INTO staged_transaction_lines(staged_transaction_id,account_id,credit,memo) VALUES($1,$2,$3,$4)',params:[id,oa,amount,cleanText(b.memo)]}]);
   await db.query('INSERT INTO duplicate_fingerprints(business_id,fingerprint,staged_transaction_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[businessId,hash,id]);await audit(businessId,u.id,'staged_created','staged_transaction',id,null,{amount,date});return res.status(201).json({id});
  }
  const id=Number(b.id);const old=(await db.query('SELECT * FROM staged_transactions WHERE id=$1 AND business_id=$2',[id,businessId])).rows[0];if(!old)return res.status(404).json({error:'Not found'});
  if(action==='approve'){if(['committed','rejected'].includes(old.status))throw new Error('Item cannot be approved in its current state');if(old.duplicate_status!=='clear'||(old.validation_warnings||[]).length)throw new Error('Resolve duplicates and validation warnings first');await db.transaction([{sql:"UPDATE staged_transactions SET status='approved',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2 AND business_id=$3",params:[u.id,id,businessId]},{sql:"INSERT INTO approval_events(business_id,staged_transaction_id,action,actor_id,note) VALUES($1,$2,'approved',$3,$4)",params:[businessId,id,u.id,cleanText(b.note)]}]);await audit(businessId,u.id,'approved','staged_transaction',id,{status:old.status},{status:'approved'});return res.json({ok:true});}
  if(action==='reject'){await db.query("UPDATE staged_transactions SET status='rejected',updated_at=now() WHERE id=$1 AND business_id=$2 AND status<>'committed'",[id,businessId]);await audit(businessId,u.id,'rejected','staged_transaction',id,{status:old.status},{status:'rejected'});return res.json({ok:true});}
  if(action==='commit'){const r=await db.query('SELECT commit_staged_transaction($1,$2,$3) id',[id,businessId,u.id]);return res.json({ledger_entry_id:r.rows[0].id,idempotent:true});}
  res.status(400).json({error:'Unknown action'});
 }catch(e){res.status(400).json({error:e.message})}
}