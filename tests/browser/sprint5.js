// Sprint 5 browser checks: trust on the homepage (first 3 phone screens), inspection approval (D13),
// "Ask for a review", review deep link.
// Usage: node tests/browser/sprint5.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [], errors = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const CT = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

async function page(b, m, viewport) {
  pre = 'window.__MOCK=' + JSON.stringify(m || {}) + ';';
  const ctx = await b.newContext({ viewport: viewport || { width: 1300, height: 900 } });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: CT[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);
const text = async (p, sel) => (await p.textContent(sel)) || '';
const STATUSES = [{ code: 'quality_inspection', rank: 10, label: 'Quality inspection', client_stage: 'Quality inspection' },
  { code: 'air_shipping', rank: 11, label: 'Express air shipping', client_stage: 'Shipped to Morocco' }];
const client = { full_name: 'Sara B', email: 'sara@x.ma', whatsapp: '+212612345678', city: 'Rabat' };
const MEDIA = [{ request_id: 'q1', path: 'staff/q1/inspection-1.jpg', file_name: 'a.jpg', media_type: 'image', created_at: iso(-1) },
  { request_id: 'q1', path: 'staff/q1/inspection-2.mp4', file_name: 'b.mp4', media_type: 'video', created_at: iso(-1) }];

(async () => {
  const b = await chromium.launch();

  // ---------- Homepage on a phone: who we are, protection and real proof in the first 3 screens ----------
  let { ctx, p } = await page(b, { session: null }, { width: 390, height: 844 });
  await p.goto('http://local.test/'); await p.waitForTimeout(900);
  const pos = await p.evaluate(() => {
    const top = (s) => { const e = document.querySelector(s); return e && e.offsetParent !== null ? Math.round(e.getBoundingClientRect().top + scrollY) : null; };
    return { protect: top('#protected .protect-list'), who: top('#who'), photo: top('#gallery figure img') };
  });
  const limit = 844 * 3;
  check('phone: "How your money is protected" within 3 screens', pos.protect != null && pos.protect < limit, JSON.stringify(pos));
  check('phone: "Who we are" within 3 screens', pos.who != null && pos.who < limit);
  check('phone: a real order photo within 3 screens', pos.photo != null && pos.photo + 120 < limit);
  const prot = await text(p, '#protected');
  check('protection: written quote, company bank account, inspection, refunds, invoice',
    /No payment before a written quote/.test(prot) && /CFG Bank/.test(prot) && /Beast Capital Group/.test(prot) && /approve/.test(prot) && /invoice/i.test(prot) && !!(await p.$('#protected a[href="/policies"]')));
  check('who we are: company, city, email; founder hidden until filled', /Casablanca/.test(await text(p, '#who')) && /contact@ddpsourcing\.com/.test(await text(p, '#who')) && !(await p.isVisible('[data-founder]')));
  check('gallery: "From China to your door" with stage labels', /From China to your door/.test(await text(p, '#shipments')) && /Arrival in Morocco/.test(await text(p, '#gallery')));
  check('footer contact: city and hours, empty social links hidden', /Casablanca, Morocco/.test(await text(p, '#contactList')) && !(await p.isVisible('[data-social]')));
  await ctx.close();
  ({ ctx, p } = await page(b, { session: null }));
  await p.goto('http://local.test/'); await p.waitForTimeout(600);
  check('desktop keeps the route card in the hero', await p.isVisible('.hero .route'));
  await ctx.close();

  // ---------- Client account: inspection approval ----------
  const req = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'u-admin', product_name: 'Earbuds', quantity: 200, delivery_city: 'Rabat', created_at: iso(-20), quote_amount_mad: 24000 }, o);
  const acct = async (r) => {
    const x = await page(b, { emptyRequests: true, addRequests: [r], extraStatuses: STATUSES, extraTables: { inspection_media: MEDIA }, rpcData: { public_settings: { termsVersion: '2026-11-v1' }, my_refunds: [] } });
    await x.p.goto('http://local.test/account'); await x.p.waitForTimeout(1200);
    await x.p.click('.req[data-id="q1"]'); await x.p.waitForTimeout(900);
    return x;
  };
  ({ ctx, p } = await acct(req({ status: 'quality_inspection', inspection_requested_at: iso(-0.5) })));
  let card = await text(p, '#dealBox');
  check('D13 client sees the inspection photos and video', /Inspection of your goods/.test(card) && /Video 2/.test(card) && (await p.$$('#inspThumbs img')).length === 1);
  check('D13 Approve shipping and I have a question', (await p.isVisible('#inspApprove')) && (await p.isVisible('#inspAsk')));
  await p.click('#inspAsk'); await p.waitForTimeout(200);
  check('I have a question prefills the conversation', /inspection photos/.test(await p.inputValue('#chatMsg')));
  p.once('dialog', (d) => d.accept()); await p.click('#inspApprove'); await p.waitForTimeout(400);
  check('Approve shipping calls approve_inspection', (await calls(p)).some((c) => c[1] === 'approve_inspection' && c[2].p_request === 'q1'));
  await ctx.close();
  ({ ctx, p } = await acct(req({ status: 'quality_inspection', inspection_requested_at: iso(-1), inspection_approved_at: iso(-0.2) })));
  check('approved: confirmation shown, no Approve button', /You approved shipping/.test(await text(p, '#dealBox')) && !(await p.$('#inspApprove')));
  await ctx.close();

  // Review link from the team opens the "Leave a review" tab.
  ({ ctx, p } = await page(b, {}));
  await p.goto('http://local.test/account?tab=reviews'); await p.waitForTimeout(1200);
  check('account?tab=reviews opens Leave a review', await p.isVisible('#tab-reviews'));
  await ctx.close();

  // ---------- CRM ----------
  const order = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'c1', product_name: 'Earbuds', quantity: 200, created_at: iso(-20), assigned_to: 'u-admin', quote_amount_mad: 24000, client, internal: null,
    payment: { request_id: 'q1', final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'not_due', deposit_verified_at: iso(-10) } }, o);
  const crm = async (role, rq, media) => {
    const x = await page(b, { role, addRequests: [rq], extraStatuses: STATUSES, extraTables: { inspection_media: media || [], business_settings: [{ id: true, refund_business_days: 7, storage_fee_after_days: 7, unpaid_cancel_after_days: 30 }] } });
    await x.p.goto('http://local.test/team'); await x.p.waitForTimeout(1200);
    await x.p.click('[data-view="requests"]'); await x.p.waitForTimeout(300);
    await x.p.click('#reqBody tr[data-id="q1"]'); await x.p.waitForTimeout(600);
    return x;
  };
  ({ ctx, p } = await crm('ops_finance', order({ status: 'quality_inspection' }), []));
  check('CRM: inspection section with upload, no photo yet', /Inspection before shipping/.test(await text(p, '#drawerBody')) && !!(await p.$('#inspFiles')) && !(await p.$('#inspSend')));
  await p.setInputFiles('#inspFiles', [{ name: 'carton.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('ffd8ffe0', 'hex') }]); await p.waitForTimeout(500);
  const c1 = await calls(p), up = c1.find((c) => c[0] === 'upload'), ins = c1.find((c) => c[0] === 'insert' && c[1] === 'inspection_media');
  check('CRM: inspection photo uploaded in the staff folder and recorded', up && /^staff\/q1\/inspection-/.test(up[1]) && ins && ins[2][0].path === up[1] && ins[2][0].media_type === 'image');
  check('Ops cannot ship without approval (no override)', !(await p.$('#inspShip')));
  await ctx.close();
  ({ ctx, p } = await crm('admin', order({ status: 'quality_inspection' }), MEDIA));
  await p.click('#inspSend'); await p.waitForTimeout(300);
  check('CRM: Ask the client to approve', (await calls(p)).some((c) => c[1] === 'request_inspection_approval' && c[2].p_request === 'q1'));
  await p.click('.rf-more:has(#inspShip) summary');
  await p.click('#inspShip'); await p.waitForTimeout(200);
  check('override needs a note', !(await calls(p)).some((c) => c[0] === 'update' && c[1] === 'requests'));
  await p.fill('#inspOverride', 'Client approved by phone'); p.once('dialog', (d) => d.accept()); await p.click('#inspShip'); await p.waitForTimeout(300);
  check('admin override sends status and note', (await calls(p)).some((c) => c[0] === 'update' && c[1] === 'requests' && c[2].status === 'air_shipping' && c[2].inspection_override_note === 'Client approved by phone'));
  await ctx.close();
  ({ ctx, p } = await crm('admin', order({ status: 'completed' }), []));
  await p.click('#askReview'); await p.waitForTimeout(300);
  const ask = (await calls(p)).find((c) => c[0] === 'insert' && c[1] === 'request_messages');
  check('CRM: Ask for a review sends the account link', ask && /account\?tab=reviews/.test(ask[2].body) && ask[2].request_id === 'q1');
  await ctx.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
