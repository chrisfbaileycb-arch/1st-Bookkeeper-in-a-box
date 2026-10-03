import express from 'express';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { connect, db, transaction, close } from './sdk.mjs';

register('./resolve-hook.mjs', import.meta.url);
const { handler } = await import('../backend/index.ts');
await connect();
await transaction(async () => {
  if (!(await db.list('auth_config',{filter:{key:'owner'}})).items.length) {
    const password = process.env.OWNER_PASSWORD;
    if (!password && process.env.NODE_ENV==='production') throw new Error('Set OWNER_PASSWORD in Render before the first deployment.');
    if (password) {
      if (password.length<12) throw new Error('OWNER_PASSWORD must contain at least 12 characters');
      const salt = randomBytes(16).toString('base64');
      const hash = pbkdf2Sync(password,Buffer.from(salt,'base64'),210000,32,'sha256').toString('base64');
      await db.add('auth_config',[{key:'owner',salt,hash,createdAt:Date.now()}]);
    }
  }
});
export const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'15mb'}));
app.get('/health',async (req,res) => {
  try { await db.list('auth_config',{limit:1}); res.json({status:'ok',database:'persistent'}); }
  catch { res.status(503).json({status:'unavailable'}); }
});
app.use('/api',async (req,res) => {
  const route = handler[req.method+' '+req.originalUrl.split('?')[0]];
  if (!route) return res.status(404).json({error:'Route not found'});
  try {
    const result = await transaction(async () => {
      let result;
      const context={headers:req.headers,query:req.query,body:req.body || {}};
      for (const fn of route) result=await fn(context);
      return result;
    });
    res.status(result.status).json(result.body);
  } catch (e) { console.error('API request failed',e); res.status(500).json({error:'Request could not be completed'}); }
});
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
app.use(express.static(dist));
app.get('*',(req,res)=>res.sendFile(dist+'index.html'));
const server=app.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Bookkeeper listening'));
process.on('SIGTERM',()=>server.close(async()=>{await close();process.exit(0)}));
