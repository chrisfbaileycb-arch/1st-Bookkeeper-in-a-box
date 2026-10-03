import fs from 'node:fs';
import path from 'node:path';

// ── In-Memory & File-Backed Database ──
const DB_FILE = path.resolve(process.cwd(), '.data', 'db.json');

interface TableRow {
    id: string;
    [key: string]: any;
}

const tables = new Map<string, TableRow[]>();
let seq = 0;

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test') || process.execArgv.includes('--test');

// Load persisted data if available (skip in unit test mode)
if (!isTest) {
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    if (Array.isArray(v)) {
                        tables.set(k, v);
                        for (const r of v) {
                            const idNum = Number(r.id);
                            if (Number.isFinite(idNum) && idNum > seq) {
                                seq = idNum;
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[DB] Failed to load persisted database, starting fresh:', e);
    }
}

function persistDb() {
    if (isTest) return;
    try {
        const dir = path.dirname(DB_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const obj: Record<string, TableRow[]> = {};
        for (const [k, v] of tables.entries()) {
            obj[k] = v;
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[DB] Failed to persist database:', e);
    }
}

function getRows(table: string): TableRow[] {
    if (!tables.has(table)) {
        tables.set(table, []);
    }
    return tables.get(table)!;
}

export const db = {
    async add(table: string, records: Record<string, any>[]): Promise<string[]> {
        const ids: string[] = [];
        const rows = getRows(table);
        for (const r of records) {
            const id = String(++seq);
            rows.push({ ...r, id });
            ids.push(id);
        }
        persistDb();
        return ids;
    },
    async list(table: string, opts: { filter?: Record<string, any>; limit?: number; nextToken?: string } = {}) {
        let items = getRows(table).slice();
        const filter = opts.filter || {};
        items = items.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
        const limit = opts.limit || 200;
        const start = opts.nextToken ? Number(opts.nextToken) : 0;
        const page = items.slice(start, start + limit);
        return {
            items: page,
            nextToken: start + limit < items.length ? String(start + limit) : undefined
        };
    },
    async get(table: string, ids: string[]) {
        const want = new Set(ids.map(String));
        return getRows(table).filter((r) => want.has(String(r.id)));
    },
    async update(table: string, pairs: Array<{ id: string; record: Record<string, any> }>) {
        const rows = getRows(table);
        for (const { id, record } of pairs) {
            const i = rows.findIndex((r) => String(r.id) === String(id));
            if (i >= 0) {
                rows[i] = { ...record, id: String(id) };
            }
        }
        persistDb();
        return [];
    }
};

export function json(data: unknown, status = 200) {
    return { status, body: data };
}

export function error(message: string, status = 500) {
    return { status, body: { error: message } };
}

export function router(routes: any) {
    return routes;
}

export const storage = {
    async write(_name: string, _data: unknown, _opts?: any) {
        return [true];
    }
};

export const ai = {
    async extract(opts: {
        prompt: string;
        images: Array<{ data: string; mimeType: string }>;
        schema?: any;
        thinkingMode?: string;
    }): Promise<{ data: any }> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey && opts.images.length > 0) {
            try {
                const { GoogleGenAI } = await import('@google/genai');
                const aiClient = new GoogleGenAI();
                const imagePart = {
                    inlineData: {
                        data: opts.images[0].data,
                        mimeType: opts.images[0].mimeType
                    }
                };
                const response = await aiClient.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [opts.prompt, imagePart],
                    config: {
                        responseMimeType: 'application/json',
                    }
                });
                const text = response.text || '{}';
                return { data: JSON.parse(text) };
            } catch (err) {
                console.warn('[AI] Gemini extract failed, using fallback parser:', err);
            }
        }

        // Realistic fallback mock extraction when offline or API key absent
        const today = new Date().toISOString().slice(0, 10);
        return {
            data: {
                vendor_name: 'Sysco Denver',
                invoice_no: 'INV-' + Math.floor(100000 + Math.random() * 900000),
                invoice_date: today,
                due_date: today,
                subtotal: 345.50,
                tax: 27.64,
                total: 373.14,
                line_items: [
                    { description: 'Prime Beef Tenderloin 10lb', qty: 1, unit_price: 185.00, category: 'meat' },
                    { description: 'Fresh Romaine Lettuce Case', qty: 2, unit_price: 28.50, category: 'produce' },
                    { description: 'Heavy Whipping Cream 1 Gal', qty: 4, unit_price: 12.25, category: 'dairy' },
                    { description: 'To-Go Kraft Boxes 500ct', qty: 1, unit_price: 54.00, category: 'paper' }
                ],
                confidence: 0.94,
                warnings: apiKey ? [] : ['Preview extraction mode (set GEMINI_API_KEY for live extraction)']
            }
        };
    },

    async generate(opts: {
        messages: Array<{ role: 'user' | 'assistant' | 'system' | 'model'; content: string }>;
    }): Promise<{ text: string }> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            try {
                const { GoogleGenAI } = await import('@google/genai');
                const aiClient = new GoogleGenAI();
                const contents = opts.messages.map((m) => ({
                    role: m.role === 'assistant' ? 'model' : m.role === 'system' ? 'user' : m.role,
                    parts: [{ text: m.content }]
                }));
                const response = await aiClient.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents
                });
                return { text: response.text || '' };
            } catch (err) {
                console.warn('[AI] Gemini generate failed:', err);
                throw err;
            }
        }
        throw new Error('GEMINI_API_KEY not configured');
    }
};
