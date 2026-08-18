import { db } from 'hatchable';
export async function membership(userId,businessId,allowed=[]){
 const id=Number(businessId); if(!id) throw new Error('business_id is required');
 const {rows}=await db.query('SELECT role FROM business_memberships WHERE business_id=$1 AND user_id=$2',[id,userId]);
 if(!rows[0]) throw new Error('Business access denied');
 if(allowed.length&&!allowed.includes(rows[0].role)) throw new Error('Role does not permit this action');
 return {businessId:id,role:rows[0].role};
}
export function cleanText(v,n=500){return String(v||'').trim().slice(0,n)}
export function money(v){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('Invalid amount');return n.toFixed(2)}
export async function audit(businessId,actor,event,entity,id,before=null,after=null,metadata={}){
 await db.query('INSERT INTO audit_events(business_id,actor_id,event_type,entity_type,entity_id,before_value,after_value,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[businessId,actor,event,entity,String(id||''),before,after,metadata]);
}