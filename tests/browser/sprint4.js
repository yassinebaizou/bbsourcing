// Sprint 4 browser checks: cancellations, refunds, claims and 60% reminders (rules D9–D17).
// Usage: node tests/browser/sprint4.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [], errors = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const DAY = 864e5, iso = (d) => new Date(Date.now() + d * DAY).toISOString();
const STATUSES = [
  { code: 'awaiting_confirmation', rank: 7, label: 'Awaiting confirmation', client_stage: 'Quotation sent' },
  { code: 'order_processing', rank: 9, label: 'Order processing', client_stage: 'In production' },
  { code: 'refund_pending', rank: 94, label: 'Refund pending', client_stage: 'Refund in progress' },
  { code: 'refunded', rank: 95, label: 'Refunded', client_stage: 'Refunded' },
  { code: 'cancelled_by_client', rank: 96, label: 'Cancelled by client', client_stage: 'Cancelled' },
  { code: 'cancelled_by_us', rank: 97, label: 'Cancelled by us', client_stage: 'Cancelled by DDPSourcing' }];
const SETTINGS = { id: true, terms_version: '2026-11-v1', quote_validity_days: 7, refund_business_days: 7, claim_hours: 72, delay_grace_days: 10,
  storage_fee_after_days: 7, unpaid_cancel_after_days: 30, storage_fee_mad: null, bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', payment_reference_note: 'x' };
const PUBLIC = { termsVersion: '2026-11-v1', refundBusinessDays: 7, claimHours: 72 };
const BANK = { bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', rib: '011780000012345678901234', reference: 'DDP-0042', reference_note: 'Write your request code.' };
const client = { full_name: 'Sara B', email: 'sara@x.ma', whatsapp: '+212612345678', city: 'Rabat' };
const req = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'u-admin', product_name: 'Earbuds', quantity: 200, delivery_city: 'Rabat', created_at: iso(-20), updated_at: iso(-1), client }, o);

async function page(b, m) {
  pre = 'window.__MOCK=' + JSON.stringify(Object.assign({ extraStatuses: STATUSES }, m)) + ';';
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    let f = path.join(ROOT, u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}
async function account(b, request, rpcData) {
  const r = await page(b, { emptyRequests: true, addRequests: [request], rpcData: Object.assign({ public_settings: PUBLIC }, rpcData || {}) });
  await r.p.goto('http://local.test/account'); await r.p.waitForTimeout(1200);
  await r.p.click('.req[data-id="q1"]'); await r.p.waitForTimeout(800);
  return r;
}
async function crm(b, role, requests, tables) {
  const r = await page(b, { role, addRequests: requests, extraTables: Object.assign({ business_settings: [SETTINGS], refunds: [], claims: [] }, tables || {}) });
  await r.p.goto('http://local.test/team'); await r.p.waitForTimeout(1200);
  return r;
}
async function drawer(p, id) {
  await p.click('[data-view="requests"]'); await p.waitForTimeout(300);
  await p.click('#reqBody tr[data-id="' + id + '"]'); await p.waitForTimeout(600);
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);
const text = async (p, sel) => (await p.textContent(sel)) || '';

(async () => {
  const b = await chromium.launch();
  const pay = (o) => Object.assign({ final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'not_due', awaiting_payment: false }, o);

  // ---------- Client account ----------
  // D10: deposit verified, before the supplier order: cancel allowed, full refund announced.
  let { ctx, p } = await account(b, req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({}), my_refunds: [] });
  check('D10 cancel shown after the 40%, before the supplier order', await p.isVisible('#cancelOpen'));
  await p.click('#cancelOpen');
  check('D10 cancel text promises the full refund', /refunded in full/.test(await text(p, '#cancelForm')));
  await ctx.close();

  // D11: no cancel once the supplier order is placed.
  ({ ctx, p } = await account(b, req({ status: 'order_processing', quote_amount_mad: 24000 }), { my_payment_info: pay({}), my_refunds: [] }));
  check('D11 no cancel button after the supplier order', !(await p.$('#cancelOpen')));
  await ctx.close();

  // D17: refund in progress and paid, as the client sees them.
  ({ ctx, p } = await account(b, req({ status: 'refund_pending', quote_amount_mad: 24000, closed_kind: 'cancelled', cancelled_by: 'client', closed_reason: 'Found it cheaper' }),
    { my_payment_info: pay({}), my_refunds: [{ amount_mad: 9600, status: 'approved', reason: 'client_cancelled_before_order', requested_at: iso(-2), approved_at: iso(-1) }] }));
  let t = await text(p, '#tab-detail');
  check('refund in progress: next step, amount, 7 business days', /Your refund is in progress/.test(t) && /MAD 9,600/.test(t) && /within 7 business days/.test(t));
  check('closed request: no progress bar, no cancel', !(await p.$('.progress')) && !(await p.$('#cancelOpen')));
  await ctx.close();
  ({ ctx, p } = await account(b, req({ status: 'refunded', quote_amount_mad: 24000 }),
    { my_payment_info: pay({}), my_refunds: [{ amount_mad: 9600, status: 'paid', reason: 'supplier_failed', requested_at: iso(-5), approved_at: iso(-4), paid_at: iso(-1), reference: 'VIR-R1', proof_path: 'staff/q1/refund.pdf' }] }));
  t = await text(p, '#dealBox');
  check('refund paid: date, reference and transfer proof', /Paid on/.test(t) && /VIR-R1/.test(t) && (await p.isVisible('#dealBox [data-proof]')));
  await ctx.close();

  // D15: 60% due with storage-fee and cancel dates.
  ({ ctx, p } = await account(b, req({ status: 'awaiting_final', quote_amount_mad: 24000 }),
    { my_payment_info: pay({ final_status: 'pending', awaiting_payment: true, bank: BANK, final_due_at: iso(-3), storage_fee_from: iso(4), cancel_after: iso(27) }), my_refunds: [] }));
  t = await text(p, '#dealBox');
  check('D15 client sees the storage-fee and cancel dates', /Pay the remaining 60%/.test(t) && /storage fee applies/.test(t) && /the order is cancelled and the deposit is kept/.test(t));
  await ctx.close();

  // D16: claim within the window, with a photo.
  ({ ctx, p } = await account(b, req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), my_refunds: [], delivered_at: iso(-0.1) }));
  check('D16 "Report a problem" within 72 hours', await p.isVisible('#claimOpen'));
  await p.click('#claimOpen'); await p.fill('#claimUnits', '3'); await p.fill('#claimText', 'Three units arrived broken.');
  await p.click('#claimSend'); await p.waitForTimeout(200);
  check('D16 a photo or video is required', /at least one photo or video/.test(await text(p, '#claimMsg')));
  await p.setInputFiles('#claimFiles', { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('ffd8ffe0', 'hex') });
  await p.click('#claimSend'); await p.waitForTimeout(600);
  const c = await calls(p), up = c.find((x) => x[0] === 'upload'), oc = c.find((x) => x[1] === 'open_claim');
  check('D16 claim photo uploaded and claim sent', up && /^u-admin\/q1\/claim-/.test(up[1]) && oc && oc[2].p_units === 3 && oc[2].p_files[0].path === up[1], JSON.stringify(oc && oc[2]).slice(0, 140));
  await ctx.close();
  ({ ctx, p } = await account(b, req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), my_refunds: [], delivered_at: iso(-4) }));
  check('D16 no claim after 72 hours', !(await p.$('#claimOpen')) && /72 hours to report a problem after delivery have passed/.test(await text(p, '#dealBox')));
  await ctx.close();

  // ---------- CRM ----------
  const order = (o) => Object.assign(req({ id: 'r9', code: 'DDP-0099', client_id: 'c1', assigned_to: 'u-admin', quote_amount_mad: 24000, internal: null,
    payment: { request_id: 'r9', final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'not_due', deposit_verified_at: iso(-10) } }), o);

  // Admin: refund to approve, cancel the order, status list without system statuses.
  ({ ctx, p } = await crm(b, 'admin', [order({ status: 'refund_pending', closed_kind: 'cancelled', cancelled_by: 'client', closed_reason: 'Found it cheaper' })],
    { refunds: [{ id: 'f1', request_id: 'r9', amount_mad: 9600, reason: 'client_cancelled_before_order', status: 'requested', requested_at: iso(-1) }] }));
  check('dashboard: "Refund to approve" for the admin', /Refund to approve/.test(await text(p, '#attentionBody')));
  check('dashboard: refunds counter', /1 to approve/.test(await text(p, '#kpiMoney')));
  await drawer(p, 'r9');
  check('drawer shows the client cancellation and refund', /The client cancelled the request/.test(await text(p, '#drawerBody')) && /Refund MAD 9,600/.test(await text(p, '#drawerBody')));
  await p.click('[data-rapprove="f1"]'); await p.waitForTimeout(300);
  check('admin approves the refund', (await calls(p)).some((x) => x[0] === 'update' && x[1] === 'refunds' && x[2].status === 'approved'));
  const opts = await p.$$eval('#dStatus option', (o) => o.map((x) => x.value)).catch(() => []);
  check('status list never offers refunded / cancelled_by_* by hand', !opts.includes('refunded') && !opts.includes('cancelled_by_us') && !opts.includes('cancelled_by_client'), opts.length + ' options');
  await ctx.close();

  ({ ctx, p } = await crm(b, 'admin', [order({ status: 'order_processing' })]));
  await drawer(p, 'r9');
  check('admin sees "Cancel the order (problem on our side)"', !!(await p.$('#tcGo')));
  await p.click('.rf-more:has(#tcGo) summary'); await p.selectOption('#tcReason', 'supplier_failed'); await p.fill('#tcNote', 'The supplier stopped this product.');
  p.once('dialog', (d) => d.accept()); await p.click('#tcGo'); await p.waitForTimeout(300);
  const tc = (await calls(p)).find((x) => x[1] === 'team_cancel_request');
  check('D12 team cancel sends reason and note', tc && tc[2].p_reason === 'supplier_failed' && /supplier stopped/.test(tc[2].p_note));
  await ctx.close();

  // Ops: refund to pay (reference required), claim answer, D15 flag.
  ({ ctx, p } = await crm(b, 'ops_finance', [order({ status: 'refund_pending' }),
    order({ id: 'r8', code: 'DDP-0098', status: 'completed', payment: { request_id: 'r8', final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'verified', deposit_verified_at: iso(-30) } }),
    order({ id: 'r7', code: 'DDP-0097', status: 'awaiting_final', payment: { request_id: 'r7', final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'pending', final_due_at: iso(-10), deposit_verified_at: iso(-30) } })],
    { refunds: [{ id: 'f2', request_id: 'r9', amount_mad: 9600, reason: 'supplier_failed', status: 'approved', requested_at: iso(-3), approved_at: iso(-2) }],
      claims: [{ id: 'k1', request_id: 'r8', client_id: 'c1', units_affected: 3, description: 'Three units broken.', status: 'open', created_at: iso(-0.1), files: [{ path: 'c1/r8/claim.jpg', file_name: 'claim.jpg', media_type: 'image' }] }] }));
  const att = await text(p, '#attentionBody');
  check('dashboard for Ops: refund to pay, claim to answer, 60% overdue', /Refund to pay/.test(att) && /Claim to answer/.test(att) && /60% unpaid: storage fee since/.test(att));
  await drawer(p, 'r9');
  check('Ops cannot approve (no Approve button)', !(await p.$('[data-rapprove]')));
  await p.click('[data-rpaid="f2"]'); await p.waitForTimeout(200);
  check('paying a refund needs the transfer reference', !(await calls(p)).some((x) => x[1] === 'refunds' && x[2].status === 'paid'));
  await p.fill('#rref_f2', 'VIR-R2'); await p.click('[data-rpaid="f2"]'); await p.waitForTimeout(300);
  check('Ops marks the refund as paid', (await calls(p)).some((x) => x[0] === 'update' && x[1] === 'refunds' && x[2].status === 'paid' && x[2].reference === 'VIR-R2'));
  await p.click('#closeDrawer'); await drawer(p, 'r8');
  check('claim with its photo in the drawer', /Claim: 3 unit/.test(await text(p, '#drawerBody')) && !!(await p.$('[data-proof="c1/r8/claim.jpg"]')));
  await p.selectOption('#clOutcome', 'refund'); await p.click('#clAnswer'); await p.waitForTimeout(200);
  check('refund answer needs an amount', !(await calls(p)).some((x) => x[1] === 'claims'));
  await p.fill('#clAmount', '720'); await p.fill('#clNote', '3 units refunded.'); await p.click('#clAnswer'); await p.waitForTimeout(300);
  check('claim answered with a refund', (await calls(p)).some((x) => x[0] === 'update' && x[1] === 'claims' && x[2].outcome === 'refund' && x[2].refund_amount_mad === 720 && x[2].status === 'resolved'));
  await p.click('#closeDrawer'); await drawer(p, 'r7');
  check('D15 flag with storage-fee and cancel dates in the drawer', /Storage fee from/.test(await text(p, '#drawerBody')) && /can be cancelled after/.test(await text(p, '#drawerBody')));
  check('Ops cannot cancel an order', !(await p.$('#tcGo')));
  await ctx.close();

  // Agent: none of the money tools.
  ({ ctx, p } = await crm(b, 'agent', [order({ status: 'order_processing' })], { refunds: [{ id: 'f3', request_id: 'r9', amount_mad: 10, reason: 'other', status: 'requested', requested_at: iso(-1) }] }));
  await drawer(p, 'r9');
  check('agent: no refund or cancel tools', !(await p.$('#tcGo')) && !(await p.$('#rfAdd')) && !(await p.$('[data-rapprove]')));
  await ctx.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
