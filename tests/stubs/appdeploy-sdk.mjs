// In-memory stub of @appdeploy/sdk for offline tests.
// Implements just enough of db/storage/ai for the backend routes under test.
const tables = new Map();
let seq = 0;

function rows(table) {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
}

export const db = {
    async add(table, records) {
        const ids = [];
        for (const r of records) {
            const id = String(++seq);
            rows(table).push({ ...r, id });
            ids.push(id);
        }
        return ids;
    },
    async list(table, opts = {}) {
        let items = rows(table).slice();
        const filter = opts.filter || {};
        items = items.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v));
        const limit = opts.limit || 200;
        const start = opts.nextToken ? Number(opts.nextToken) : 0;
        const page = items.slice(start, start + limit);
        return { items: page, nextToken: start + limit < items.length ? String(start + limit) : undefined };
    },
    async get(table, ids) {
        const want = new Set(ids.map(String));
        return rows(table).filter((r) => want.has(String(r.id)));
    },
    async update(table, pairs) {
        for (const { id, record } of pairs) {
            const arr = rows(table);
            const i = arr.findIndex((r) => String(r.id) === String(id));
            if (i >= 0) arr[i] = { ...record, id: String(id) };
        }
        return [];
    },
};

export function json(data, status = 200) {
    return { status, body: data };
}

export function error(message, status = 500) {
    return { status, body: { error: message } };
}

// In tests, router() returns the routes table so tests can call handlers directly.
export function router(routes) {
    return routes;
}

export const storage = {
    async write() {
        return [false];
    },
};

export const ai = {
    async extract() {
        throw new Error('ai.extract is not stubbed in tests');
    },
    async generate() {
        throw new Error('ai.generate is not stubbed in tests');
    },
};
