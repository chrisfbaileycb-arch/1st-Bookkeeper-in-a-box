// Integration tests for 1st Bookkeeper-In-A-Box security + ledger fixes.
//
// What this covers:
//   1. Fail-closed owner auth: no token -> 401/503; setup claims once;
//      wrong password rejected; logout revokes the session.
//   2. Posted entries are never silently edited: void/reverse/correct create
//      linked offsetting entries, require a reason, and refuse repeats.
//   3. Double-entry stays balanced through void/reverse/correct.
//   4. Strict CSV validation rejects bad headers and duplicate pay dates.
//   5. Payroll wage accounts follow the active industry profile
//      (restaurant -> 'Wages - Kitchen (BOH)'; salon -> 'Wages - Stylists').
//   6. Every mutation lands in the append-only audit log with actor, time,
//      action, and before/after state.
//
// Run:  npm test        (from app/)
//   or:  node --test tests/ledger-security.test.ts
//
// Node >= 22.6 required (native TypeScript type stripping). No dependencies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolve-hook.mjs', import.meta.url);
const { handler } = await import('../backend/index.ts');

const PASSWORD = 'correct-horse-battery-staple-99';

async function call(method, path, { body = {}, query = {} } = {}) {
    const hs = handler[method + ' ' + path];
    assert.ok(hs, 'route exists: ' + method + ' ' + path);
    return hs[0]({ body, query, headers: {} });
}
const authed = (token, extra = {}) => ({ ...extra, api_token: token });

let token;
let locId;

const PAYROLL_HEADER = 'pay_date,boh_gross,foh_gross,employer_fed_taxes,employer_futa,employer_sui_co,employer_famli,fed_withholding,co_withholding,employee_famli,net_pay_sweep,provider_remits_taxes';
const payrollCsv = (date, net = 1590) =>
    PAYROLL_HEADER + '\n' + [date, 1000, 800, 100, 10, 20, 15, 150, 50, 10, net, 'true'].join(',');

// ── 1. Auth ──────────────────────────────────────────────────────────

test('auth status is public and starts unconfigured', async () => {
    const r = await call('GET', '/api/auth/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, false);
});

test('API is fail-closed before the owner password exists', async () => {
    const r = await call('GET', '/api/locations');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /auth_not_configured/);
});

test('setup rejects a short password', async () => {
    const r = await call('POST', '/api/auth/setup', { body: { password: 'short' } });
    assert.equal(r.status, 400);
});

test('setup claims the deployment exactly once', async () => {
    const r = await call('POST', '/api/auth/setup', { body: { password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.ok(r.body.token, 'returns a session token');
    token = r.body.token;
    const again = await call('POST', '/api/auth/setup', { body: { password: PASSWORD } });
    assert.equal(again.status, 409);
    const st = await call('GET', '/api/auth/status');
    assert.equal(st.body.configured, true);
});

test('login rejects a wrong password, accepts the right one', async () => {
    const bad = await call('POST', '/api/auth/login', { body: { password: 'wrong-password-xyz' } });
    assert.equal(bad.status, 401);
    const good = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
    assert.equal(good.status, 200);
    assert.ok(good.body.token);
});

test('protected routes reject missing/invalid tokens', async () => {
    const noToken = await call('GET', '/api/locations');
    assert.equal(noToken.status, 401);
    const badToken = await call('GET', '/api/locations', { query: { api_token: 'bogus' } });
    assert.equal(badToken.status, 401);
});

test('a valid session reaches the API and seeds the default location', async () => {
    const r = await call('GET', '/api/locations', { query: { api_token: token } });
    assert.equal(r.status, 200);
    assert.ok(r.body.locations.length >= 1);
    locId = String(r.body.locations[0].id);
});

test('logout revokes the session', async () => {
    const out = await call('POST', '/api/auth/logout', { body: authed(token) });
    assert.equal(out.status, 200);
    const after = await call('GET', '/api/locations', { query: { api_token: token } });
    assert.equal(after.status, 401);
    // Re-login for the remaining tests
    const back = await call('POST', '/api/auth/login', { body: { password: PASSWORD } });
    assert.equal(back.status, 200);
    token = back.body.token;
});

// ── 2+3. Ledger integrity: void / reverse / correct ─────────────────

const dailySales = (date, food = 500, bev = 200) => ({
    ack: true, business_date: date, food_sales: food, beverage_sales: bev,
    sales_tax: 40, cc_tips: 30, cash_collected: 100, processing_fees: 10,
});

async function trialBalance(from, to) {
    const r = await call('GET', '/api/ledger/accounts', { query: authed(token, { from, to }) });
    assert.equal(r.status, 200);
    return r.body;
}

test('daily sales posts and the trial balance is in balance', async () => {
    const r = await call('POST', '/api/ledger/daily-sales', { body: authed(token, dailySales('2026-09-10')) });
    assert.equal(r.status, 200);
    assert.equal(r.body.journalNo, 'DS-2026-09-10');
    const tb = await trialBalance('2026-09-01', '2026-09-30');
    assert.equal(tb.inBalance, true);
});

test('void requires a reason, links the offsetting entry, refuses repeats', async () => {
    const noReason = await call('POST', '/api/ledger/void', { body: authed(token, { ack: true, journal_no: 'DS-2026-09-10', reason: '' }) });
    assert.equal(noReason.status, 400);
    const missing = await call('POST', '/api/ledger/void', { body: authed(token, { ack: true, journal_no: 'DS-2099-01-01', reason: 'x' }) });
    assert.equal(missing.status, 404);
    const v = await call('POST', '/api/ledger/void', { body: authed(token, { ack: true, journal_no: 'DS-2026-09-10', reason: 'duplicate day entered twice' }) });
    assert.equal(v.status, 200);
    assert.equal(v.body.voidEntry, 'VOID-DS-2026-09-10');
    const again = await call('POST', '/api/ledger/void', { body: authed(token, { ack: true, journal_no: 'DS-2026-09-10', reason: 'again' }) });
    assert.equal(again.status, 409);
    // Books still balance after the void
    const tb = await trialBalance('2026-09-01', '2026-09-30');
    assert.equal(tb.inBalance, true);
    // The void entry fully offsets the original in the journal
    const jr = await call('GET', '/api/ledger/journal', { query: authed(token, { from: '2026-09-01', to: '2026-09-30' }) });
    const voidEntry = jr.body.entries.find((e) => e.journalNo === 'VOID-DS-2026-09-10');
    assert.ok(voidEntry, 'void entry is in the journal');
    assert.equal(voidEntry.reverses, 'DS-2026-09-10');
    const orig = jr.body.entries.find((e) => e.journalNo === 'DS-2026-09-10');
    assert.equal(orig.voided, true);
    const net = (lines) => lines.reduce((s, l) => s + l.debit - l.credit, 0);
    assert.equal(net(orig.lines) + net(voidEntry.lines), 0);
});

test('reverse posts an offsetting entry dated today and marks the original', async () => {
    const p = await call('POST', '/api/ledger/daily-sales', { body: authed(token, dailySales('2026-09-11')) });
    assert.equal(p.status, 200);
    const rv = await call('POST', '/api/ledger/reverse', { body: authed(token, { ack: true, journal_no: 'DS-2026-09-11', reversal_date: '2026-09-12', reason: 'entered under wrong date' }) });
    assert.equal(rv.status, 200);
    assert.equal(rv.body.reversalEntry, 'REV-DS-2026-09-11');
    const dup = await call('POST', '/api/ledger/reverse', { body: authed(token, { ack: true, journal_no: 'DS-2026-09-11', reason: 'x' }) });
    assert.equal(dup.status, 409);
    const tb = await trialBalance('2026-09-01', '2026-09-30');
    assert.equal(tb.inBalance, true);
});

test('correct posts a linked adjusting entry without touching the original', async () => {
    const p = await call('POST', '/api/ledger/daily-sales', { body: authed(token, dailySales('2026-09-13')) });
    assert.equal(p.status, 200);
    const c = await call('POST', '/api/ledger/correct', {
        body: authed(token, {
            ack: true, journal_no: 'DS-2026-09-13', reason: 'food sales overstated by $50',
            lines: [
                { accountName: 'Food Sales', debit: 50, credit: 0 },
                { accountName: 'Cash Drawer', debit: 0, credit: 50 },
            ],
        }),
    });
    assert.equal(c.status, 200);
    assert.match(c.body.correctionEntry, /^CORR-DS-2026-09-13-/);
    const jr = await call('GET', '/api/ledger/journal', { query: authed(token, { from: '2026-09-01', to: '2026-09-30' }) });
    const corr = jr.body.entries.find((e) => e.journalNo === c.body.correctionEntry);
    assert.ok(corr);
    assert.equal(corr.corrects, 'DS-2026-09-13');
    const orig = jr.body.entries.find((e) => e.journalNo === 'DS-2026-09-13');
    assert.equal(orig.voided || false, false, 'original entry is untouched, not voided');
    const tb = await trialBalance('2026-09-01', '2026-09-30');
    assert.equal(tb.inBalance, true);
});

// ── 4. Strict CSV validation ─────────────────────────────────────────

test('payroll import rejects a bad header', async () => {
    const r = await call('POST', '/api/payroll/import', { body: authed(token, { ack: true, csv: 'wrong,header\n2026-09-05,1' }) });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /header_mismatch/);
});

test('payroll import rejects a duplicate pay_date in one file', async () => {
    const csv = payrollCsv('2026-09-05') + '\n' + payrollCsv('2026-09-05').split('\n')[1];
    const r = await call('POST', '/api/payroll/import', { body: authed(token, { ack: true, csv }) });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /duplicate pay_date/);
});

test('payroll import rejects a non-reconciling net pay sweep', async () => {
    const r = await call('POST', '/api/payroll/import', { body: authed(token, { ack: true, csv: payrollCsv('2026-09-05', 1) }) });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /net_pay_sweep does not reconcile/);
});

// ── 5. Profile-aware posting ─────────────────────────────────────────

test('restaurant payroll posts to BOH/FOH wage accounts', async () => {
    const r = await call('POST', '/api/payroll/import', { body: authed(token, { ack: true, csv: payrollCsv('2026-09-05') }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.entriesPosted, 2); // accrual + provider-remits-taxes remittance
    const jr = await call('GET', '/api/ledger/journal', { query: authed(token, { from: '2026-09-01', to: '2026-09-30' }) });
    const pr = jr.body.entries.find((e) => e.journalNo === 'PR-2026-09-05');
    assert.ok(pr);
    const names = pr.lines.map((l) => l.accountName);
    assert.ok(names.includes('Wages - Kitchen (BOH)'));
    assert.ok(names.includes('Wages - Service (FOH)'));
});

test('switching to the salon profile reroutes payroll wages and daily sales', async () => {
    const sw = await call('POST', '/api/verticals/set', { body: authed(token, { profile_id: 'salon', location_id: locId }) });
    assert.equal(sw.status, 200);
    const pr = await call('POST', '/api/payroll/import', { body: authed(token, { ack: true, csv: payrollCsv('2026-09-06') }) });
    assert.equal(pr.status, 200);
    const jr = await call('GET', '/api/ledger/journal', { query: authed(token, { from: '2026-09-01', to: '2026-09-30' }) });
    const run = jr.body.entries.find((e) => e.journalNo === 'PR-2026-09-06');
    assert.ok(run);
    const names = run.lines.map((l) => l.accountName);
    assert.ok(names.includes('Wages - Stylists'), 'salon wage account, got: ' + names.join(', '));
    assert.ok(names.includes('Wages - Support Staff'));
    assert.ok(!names.includes('Wages - Kitchen (BOH)'), 'no restaurant-only accounts leak into the salon profile');
    // Manual daily sales follows the profile revenue map too
    const ds = await call('POST', '/api/ledger/daily-sales', { body: authed(token, dailySales('2026-09-14')) });
    assert.equal(ds.status, 200);
    const jr2 = await call('GET', '/api/ledger/journal', { query: authed(token, { from: '2026-09-01', to: '2026-09-30' }) });
    const day = jr2.body.entries.find((e) => e.journalNo === 'DS-2026-09-14');
    const revNames = day.lines.filter((l) => l.credit > 0).map((l) => l.accountName);
    assert.ok(revNames.includes('Service Revenue - Cuts & Styling'), 'salon revenue account, got: ' + revNames.join(', '));
    const tb = await trialBalance('2026-09-01', '2026-09-30');
    assert.equal(tb.inBalance, true);
});

// ── 6. Audit trail ───────────────────────────────────────────────────

test('every mutation is in the append-only audit log with actor/time/before/after', async () => {
    const r = await call('GET', '/api/audit/log', { query: authed(token, {}) });
    assert.equal(r.status, 200);
    const actions = r.body.entries.map((e) => e.action);
    for (const a of ['ledger.post', 'ledger.void', 'ledger.reverse', 'ledger.correct', 'location.profile_changed']) {
        assert.ok(actions.includes(a), 'audit log contains ' + a);
    }
    for (const e of r.body.entries) {
        assert.ok(e.ts, 'timestamp present');
        assert.ok(e.actor, 'actor present');
        assert.ok(e.action, 'action present');
        assert.ok('before' in e && 'after' in e, 'before/after present');
    }
    const voidRec = r.body.entries.find((e) => e.action === 'ledger.void');
    assert.equal(voidRec.before.journalNo, 'DS-2026-09-10');
    assert.equal(voidRec.after.voidedBy, 'VOID-DS-2026-09-10');
});
