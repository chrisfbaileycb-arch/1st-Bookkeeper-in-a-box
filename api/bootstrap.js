import { db } from 'hatchable';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const u=req.user;
 const found=await db.query('SELECT b.id,b.name,m.role FROM businesses b JOIN business_memberships m ON m.business_id=b.id WHERE m.user_id=$1 ORDER BY b.id',[u.id]);
 if(found.rows.length){for(const business of found.rows)await db.query("INSERT INTO customer_onboarding(business_id,user_id,plan,payment_status,business_name,location_name,data_source,bank_status,current_step,onboarding_complete,last_agent_message) VALUES($1,$2,'founding_249','legacy_owner',$3,COALESCE((SELECT name FROM locations WHERE business_id=$1 ORDER BY id LIMIT 1),'Main Location'),'csv','skipped',5,true,'Welcome back. Your existing workspace is ready.') ON CONFLICT(business_id) DO NOTHING",[business.id,u.id,business.name]);return res.json({businesses:found.rows});}
 const name=String(req.body?.name||'My Business').trim().slice(0,120);
 const b=await db.query('INSERT INTO businesses(name,created_by) VALUES($1,$2) RETURNING id,name',[name,u.id]);
 const id=b.rows[0].id;
 await db.transaction([
  {sql:"INSERT INTO business_memberships(business_id,user_id,email,role) VALUES($1,$2,$3,'owner')",params:[id,u.id,u.email]},
  {sql:"INSERT INTO chart_of_accounts(business_id,account_no,name,type) VALUES($1,'1000','Cash - Operating','asset')",params:[id]},
  {sql:"INSERT INTO chart_of_accounts(business_id,account_no,name,type) VALUES($1,'2000','Accounts Payable','liability')",params:[id]},
  {sql:"INSERT INTO chart_of_accounts(business_id,account_no,name,type) VALUES($1,'5000','Cost of Goods Sold','cogs')",params:[id]},
  {sql:"INSERT INTO chart_of_accounts(business_id,account_no,name,type) VALUES($1,'6000','General Expense','expense')",params:[id]},
  {sql:"INSERT INTO locations(business_id,name) VALUES($1,'Main Location')",params:[id]},
  {sql:"INSERT INTO customer_onboarding(business_id,user_id,plan,payment_status,business_name,location_name,current_step,onboarding_complete) VALUES($1,$2,'founding_249','pending',$3,'Main Location',2,false)",params:[id,u.id,name]},
  {sql:"INSERT INTO audit_events(business_id,actor_id,event_type,entity_type,entity_id,after_value) VALUES($1,$2,'business_created','business',$1::text,$3::jsonb)",params:[id,u.id,JSON.stringify({name})]}
 ]);
 res.status(201).json({businesses:[{id,name,role:'owner'}]});
}