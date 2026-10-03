import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

test('Render runtime persists owner, ledger and audit; rejects unauthorized and duplicate writes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'bookkeeper-runtime-'));
  const password=randomBytes(24).toString('hex');
  let child;
  const base='http://127.0.0.1:14831';
  async function start() {
    child=spawn(process.execPath,['runtime/server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,NODE_ENV:'test',LOCAL_DATABASE_DIR:directory,PORT:'14831',OWNER_PASSWORD:password},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      let errors=''; const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),20000);
      child.stderr.on('data',d=>{errors+=d});
      child.stdout.on('data',d=>{if(String(d).includes('Bookkeeper listening')){clearTimeout(timeout);resolve()}});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code+': '+errors.slice(-2000)))});
    });
  }
  async function stop() { if (!child || child.exitCode!==null)return;const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exit; }
  async function call(path,body,token) {
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  try {
    await start();
    assert.equal((await call('/health')).status,200);
    assert.equal((await call('/api/ledger/accounts')).status,401);
    assert.equal((await call('/api/auth/setup',{password})).status,409);
    const login=await call('/api/auth/login',{password});assert.equal(login.status,200);const token=login.body.token;
    const sales={ack:true,business_date:'2026-10-01',food_sales:500,beverage_sales:200,sales_tax:40,cc_tips:30,cash_collected:100,processing_fees:10};
    const writes=await Promise.all([call('/api/ledger/daily-sales',sales,token),call('/api/ledger/daily-sales',sales,token)]);
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,422]);
    const journal=await call('/api/ledger/journal?from=2026-10-01&to=2026-10-31',null,token);
    assert.equal(journal.body.entries.length,1);
    const entry=journal.body.entries[0];
    assert.equal(entry.lines.reduce((s,l)=>s+l.debit-l.credit,0),0);
    const audit=await call('/api/audit/log',null,token);assert.ok(audit.body.entries.length>=1);
    await stop(); await start();
    assert.equal((await call('/api/auth/status')).body.configured,true);
    const restored=await call('/api/ledger/journal?from=2026-10-01&to=2026-10-31',null,token);
    assert.equal(restored.status,200);assert.equal(restored.body.entries.length,1);
    assert.equal((await call('/api/auth/login',{password:'wrong-password'})).status,401);
  } finally { await stop();await rm(directory,{recursive:true,force:true}); }
});
