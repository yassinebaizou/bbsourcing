// Sprint 3 browser checks: quote card, accept / decline / ask, payment instructions and transfer proof,
// client cancellation, CRM Settings, live rule values on the public pages.
// Usage: node tests/browser/sprint3.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
let liveSettings = null;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

async function newContext(b, viewport) {
  const ctx = await b.newContext({ viewport: viewport || { width: 1300, height: 900 } });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/rest/v1/rpc/public_settings' && liveSettings) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(liveSettings) });
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    else if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(f)] || 'application/octet-stream';
    r.fulfill({ body: fs.readFileSync(f), contentType: ct });
  });
  return ctx;
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);
const day = 864e5;
const STATUSES = [{ code: 'awaiting_confirmation', rank: 7, label: 'Awaiting confirmation', client_stage: 'Quotation sent' },
  { code: 'order_processing', rank: 9, label: 'Order processing', client_stage: 'In production' }];
const SETTINGS = { termsVersion: '2026-11-v1', quoteValidityDays: 7, refundBusinessDays: 7, claimHours: 72 };
const BANK = { bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', rib: '011780000012345678901234', iban: null, swift: null, reference: 'DDP-0042', reference_note: 'Write your request code as the transfer reference.' };
const req = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'u-admin', product_name: 'Earbuds', quantity: 200, delivery_city: 'Rabat', created_at: new Date().toISOString() }, o);
function mockFor(request, rpcData) {
  return 'window.__MOCK=' + JSON.stringify({ emptyRequests: true, addRequests: [request], extraStatuses: STATUSES, rpcData: Object.assign({ public_settings: SETTINGS }, rpcData || {}) }) + ';';
}
async function openRequest(b, request, rpcData, errors) {
  pre = mockFor(request, rpcData);
  const ctx = await newContext(b); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1200);
  await p.click('.req[data-id="q1"]'); await p.waitForTimeout(800);
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  console.log('Site folder: ' + ROOT);

  // 1. Quote card: amounts, expiry, Terms checkbox, Accept.
  let { ctx, p } = await openRequest(b, req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: new Date().toISOString(), quote_expires_at: new Date(Date.now() + 7 * day).toISOString() }),
    { my_payment_info: { final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'pending', final_status: 'not_due', awaiting_payment: false } }, errors);
  let card = (await p.textContent('#dealBox')) || '';
  check('quote card shows total, unit price, 40% and 60%', /MAD 24,000/.test(card) && /MAD 120 per unit × 200 units/.test(card) && /MAD 9,600/.test(card) && /MAD 14,400/.test(card), card.slice(0, 160));
  check('quote card shows expiry, Terms version and links', /Valid until/.test(card) && /version 2026-11-v1/.test(card) && (await p.$('#dealBox a[href="/policies"]')) && (await p.$('#dealBox a[href="/terms"]')) ? true : false);
  check('Accept, Ask a question and Decline buttons', (await p.isVisible('#dealAccept')) && (await p.isVisible('#dealAsk')) && (await p.isVisible('#dealDecline')));
  await p.click('#dealAccept'); await p.waitForTimeout(200);
  check('Accept without ticking the Terms is refused', /Tick the box/.test(await p.textContent('#dealMsg')) && !(await calls(p)).some((c) => c[1] === 'accept_quote'));
  await p.check('#dealTerms'); await p.click('#dealAccept'); await p.waitForTimeout(400);
  let acc = (await calls(p)).find((c) => c[1] === 'accept_quote');
  check('Accept calls accept_quote with the Terms version', acc && acc[2].p_request === 'q1' && acc[2].p_terms_version === '2026-11-v1', JSON.stringify(acc && acc[2]));
  await ctx.close();

  // 2. Ask a question / decline with a reason.
  ({ ctx, p } = await openRequest(b, req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: new Date().toISOString(), quote_expires_at: new Date(Date.now() + 7 * day).toISOString() }), {}, errors));
  await p.click('#dealAsk'); await p.waitForTimeout(300);
  check('Ask a question prefills the conversation', /Question about my quote/.test(await p.inputValue('#chatMsg')));
  await p.click('#dealDecline'); await p.fill('#declineWhy', 'Price too high');
  p.once('dialog', (d) => d.accept()); await p.click('#declineGo'); await p.waitForTimeout(400);
  let dec = (await calls(p)).find((c) => c[1] === 'decline_quote');
  check('Decline sends the reason', dec && dec[2].p_reason === 'Price too high');
  await ctx.close();

  // 3. Expired quote: no Accept button.
  ({ ctx, p } = await openRequest(b, req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: new Date(Date.now() - 9 * day).toISOString(), quote_expires_at: new Date(Date.now() - 2 * day).toISOString() }), {}, errors));
  card = (await p.textContent('#dealBox')) || '';
  check('expired quote cannot be accepted from the page', /expired on/.test(card) && !(await p.$('#dealAccept')), card.slice(-140));
  await ctx.close();

  // 4. Payment instructions + transfer proof (40%), cancel still possible.
  const payInfo = { final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'pending', final_status: 'not_due', awaiting_payment: true, bank: BANK };
  ({ ctx, p } = await openRequest(b, req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: payInfo }, errors));
  card = (await p.textContent('#dealBox')) || '';
  check('payment card shows bank, holder, RIB and reference', /Pay the 40% deposit/.test(card) && /MAD 9,600/.test(card) && /CFG Bank/.test(card) && /Beast Capital Group/.test(card) && /011780000012345678901234/.test(card) && /DDP-0042/.test(card));
  await p.click('#proofSend'); await p.waitForTimeout(200);
  check('proof is required before sending', /Choose the photo/.test(await p.textContent('#proofMsg')));
  await p.setInputFiles('#proofFile', { name: 'virement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await p.fill('#proofRef', 'VIR-77'); await p.click('#proofSend'); await p.waitForTimeout(500);
  let c4 = await calls(p), up = c4.find((c) => c[0] === 'upload'), sp = c4.find((c) => c[1] === 'submit_payment_proof');
  check('proof uploaded in the client folder and registered as the 40%', up && /^u-admin\/q1\/proof-deposit-/.test(up[1]) && sp && sp[2].p_part === 'deposit' && sp[2].p_path === up[1] && sp[2].p_reference === 'VIR-77', JSON.stringify(sp && sp[2]));
  check('cancel button shown before the 40% is verified', await p.isVisible('#cancelOpen'));
  await p.click('#cancelOpen'); await p.fill('#cancelWhy', 'Changed plans');
  p.once('dialog', (d) => d.accept()); await p.click('#cancelGo'); await p.waitForTimeout(400);
  check('cancel sends the reason', (await calls(p)).some((c) => c[1] === 'cancel_request' && c[2].p_reason === 'Changed plans'));
  await ctx.close();

  // 5. Bank details not set yet: no number shown, clear message.
  ({ ctx, p } = await openRequest(b, req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: Object.assign({}, payInfo, { bank: Object.assign({}, BANK, { rib: null }) }) }, errors));
  check('without a RIB the page says the details are coming', /bank details will appear here/.test(await p.textContent('#dealBox')));
  await ctx.close();

  // 6. After the deposit is verified (supplier order): no cancel button, no bank details.
  ({ ctx, p } = await openRequest(b, req({ status: 'order_processing', quote_amount_mad: 24000 }), { my_payment_info: Object.assign({}, payInfo, { deposit_status: 'verified', awaiting_payment: false, bank: undefined }) }, errors));
  check('no cancel button and no bank details after the supplier order', !(await p.$('#cancelOpen')) && !/RIB/.test((await p.textContent('#dealBox')) || ''));
  await ctx.close();

  // 7. CRM Settings: admin edits, agent has no Settings page.
  pre = 'window.__MOCK=' + JSON.stringify({ role: 'admin', extraTables: { business_settings: [{ id: true, terms_version: '2026-11-v1', bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', rib: null, iban: null, swift: null, payment_reference_note: 'Write your request code.', quote_validity_days: 7, refund_business_days: 7, claim_hours: 72, delay_grace_days: 10, storage_fee_after_days: 7, unpaid_cancel_after_days: 30, storage_fee_mad: null }] } }) + ';';
  ctx = await newContext(b); p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://local.test/team'); await p.waitForTimeout(1200);
  check('admin sees Settings in the CRM', await p.isVisible('#navSettings'));
  await p.click('#navSettings'); await p.waitForTimeout(500);
  await p.fill('#set_rib', '0117 8000 0012 3456 7890 12'); await p.click('#saveSettings'); await p.waitForTimeout(300);
  check('a RIB without 24 digits is refused', !(await calls(p)).some((c) => c[0] === 'update' && c[1] === 'business_settings'));
  await p.fill('#set_rib', '011 780 000012345678901234'); await p.fill('#set_storage_fee_mad', ''); await p.click('#saveSettings'); await p.waitForTimeout(400);
  const upd = (await calls(p)).find((c) => c[0] === 'update' && c[1] === 'business_settings');
  check('admin saves the RIB and rules', upd && upd[2].rib === '011 780 000012345678901234' && upd[2].quote_validity_days === 7 && upd[2].storage_fee_mad === null, JSON.stringify(upd && upd[2]).slice(0, 120));
  await ctx.close();
  pre = 'window.__MOCK={role:"agent"};';
  ctx = await newContext(b); p = await ctx.newPage();
  await p.goto('http://local.test/team'); await p.waitForTimeout(1200);
  check('sourcing agent has no Settings page', !(await p.isVisible('#navSettings')));
  await ctx.close();

  // 8. Public pages show the live values from CRM → Settings.
  liveSettings = { termsVersion: '2026-11-v1', quoteValidityDays: 10, claimHours: 48, storageFeeMad: 25 };
  ctx = await newContext(b); p = await ctx.newPage();
  await p.goto('http://local.test/policies'); await p.waitForTimeout(800);
  const v = await p.$$eval('[data-policy="quoteValidityDays"]', (els) => els.map((e) => e.textContent));
  const fee = await p.isVisible('[data-policy-if="storageFeeMad"]');
  check('/policies shows the live quote validity, claim hours and storage fee', v.every((x) => x === '10') && (await p.textContent('[data-policy="claimHours"]')) === '48' && fee, v.join(','));
  check('public settings never carry bank details', !('rib' in liveSettings));
  liveSettings = null;
  await ctx.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})();
