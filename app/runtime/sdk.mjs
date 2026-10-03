import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

let pool;
const context = new AsyncLocalStorage();
let queue = Promise.resolve();
export async function connect() {
  if (pool) return;
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  } else if (process.env.NODE_ENV !== 'production' && process.env.LOCAL_DATABASE_DIR) {
    const { PGlite } = await import('@electric-sql/pglite');
    pool = new PGlite(process.env.LOCAL_DATABASE_DIR);
    await pool.waitReady;
  } else throw new Error('DATABASE_URL is required. Bookkeeper must use persistent storage.');
  const ddl = `CREATE TABLE IF NOT EXISTS bookkeeper_records (
    sequence BIGSERIAL UNIQUE, collection TEXT NOT NULL, id TEXT PRIMARY KEY, record JSONB NOT NULL);
    CREATE INDEX IF NOT EXISTS bookkeeper_collection ON bookkeeper_records(collection, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS bookkeeper_owner ON bookkeeper_records((record->>'key')) WHERE collection='auth_config';
    CREATE TABLE IF NOT EXISTS bookkeeper_files (path TEXT PRIMARY KEY, content BYTEA NOT NULL, content_type TEXT NOT NULL);`;
  for (const statement of ddl.split(';').filter(s=>s.trim())) await pool.query(statement);
}
export async function close() { if (pool?.end) await pool.end(); else if (pool?.close) await pool.close(); pool = undefined; }
const query = (sql, args) => (context.getStore() || pool).query(sql, args);

// Keep each API mutation and its audit/ledger writes in a single transaction.
// The database lock also serializes duplicate posting and owner setup across replicas.
export async function transaction(fn) {
  if (pool instanceof pg.Pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(186477091)');
      const result = await context.run(client, fn);
      if (result?.status >= 400) await client.query('ROLLBACK'); else await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  const previous = queue;
  let release;
  queue = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await pool.transaction(tx => context.run(tx, fn)); } finally { release(); }
}

export const db = {
  async add(collection, records) {
    const ids = [];
    for (const record of records) {
      const id = randomUUID();
      await query('INSERT INTO bookkeeper_records(collection,id,record) VALUES($1,$2,$3::jsonb)', [collection,id,JSON.stringify(record)]);
      ids.push(id);
    }
    return ids;
  },
  async list(collection, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 1000);
    const after = Number(options.nextToken) || 0;
    const { rows } = await query('SELECT id,record,sequence FROM bookkeeper_records WHERE collection=$1 AND record @> $2::jsonb AND sequence>$3 ORDER BY sequence LIMIT $4', [collection,JSON.stringify(options.filter || {}),after,limit + 1]);
    const page = rows.slice(0,limit);
    return { items: page.map(r => ({ ...r.record,id:r.id })), nextToken: rows.length > limit ? String(page.at(-1).sequence) : undefined };
  },
  async get(collection, ids) {
    const { rows } = await query('SELECT id,record FROM bookkeeper_records WHERE collection=$1 AND id=ANY($2::text[])', [collection,ids.map(String)]);
    return rows.map(r => ({ ...r.record,id:r.id }));
  },
  async update(collection, pairs) {
    for (const { id, record } of pairs) await query('UPDATE bookkeeper_records SET record=$1::jsonb WHERE collection=$2 AND id=$3', [JSON.stringify(record),collection,String(id)]);
    return [];
  }
};
export const router = routes => routes;
export const json = (body, status = 200) => ({ status,body });
export const error = (message, status = 500) => json({ error:message },status);
export const storage = {
  async write(files) {
    for (const f of files) {
      const data = f.content.replace(/^data:[^,]*,/, '');
      await query('INSERT INTO bookkeeper_files(path,content,content_type) VALUES($1,$2,$3) ON CONFLICT(path) DO UPDATE SET content=excluded.content,content_type=excluded.content_type', [f.path,Buffer.from(data,'base64'),f.contentType]);
    }
    return files.map(() => true);
  }
};

async function generate(contents, config = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents,...config}),signal:AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status})`);
  const body = await response.json();
  const text = body.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
  if (!text) throw new Error('AI returned no content');
  return text;
}
export const ai = {
  async extract({prompt,images,schema}) {
    const parts = [{text:prompt},...images.map(i=>({inlineData:{mimeType:i.mimeType,data:i.data.replace(/^data:[^,]*,/, '')}}))];
    return {data:JSON.parse(await generate([{role:'user',parts}],{generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema}}))};
  },
  async generate({messages}) {
    const system = messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const contents = messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='user'?'user':'model',parts:[{text:m.content}]}));
    return {text:await generate(contents,system ? {systemInstruction:{parts:[{text:system}]}} : {})};
  }
};
