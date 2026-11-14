// Sprint 8 browser checks: Arabic pages and Arabic client account (right-to-left).
// Usage: node tests/browser/sprint8.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
// Also run: node tools/build-i18n.mjs --check   (translated public pages up to date)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [], errors = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const CT = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function page(b, m, viewport, storage) {
  pre = 'window.__MOCK=' + JSON.stringify(m || {}) + ';';
  const ctx = await b.newContext({ viewport: viewport || { width: 1300, height: 900 } });
  if (storage) await ctx.addInitScript((s) => { Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); }, storage);
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    const p = u.pathname;  // /ar/account = real generated file
    let f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    else if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: CT[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);

// Every text of the page (hidden parts too) that still looks English. Client content (translate="no") is skipped.
// English words that are not French words; letters around them (é, à…) count as part of the word.
const ENGLISH = /(?<!\p{L})(the|your|you|our|we|and|with|for|this|is|are|to|of|order|request|quote|units?|payment|deposit|send|please|days?|hours?|before|after|shipping|delivery|price|refund|claim|email|password|account|review|ask|back|save|cancel|approve|paid|sent|step|new)(?!\p{L})/iu;
const ALLOW = /^(DDP|SOURCING|DDPSourcing|WhatsApp|USD|MAD|RIB|IBAN|SWIFT|Email|E-mail|FR|EN|English|Français|العربية|Production|Budget|Contact|Service|Notes?)$/;
async function leftovers(p) {
  return p.evaluate(({ src, allow }) => {
    const en = new RegExp(src, 'iu'), ok = new RegExp(allow), out = new Set();
    const skip = (el) => !el || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(el.tagName) || el.closest('[translate="no"]');
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t && !skip(n.parentElement) && en.test(t) && !ok.test(t)) out.add(t); }
    document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach((el) => {
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest('[translate="no"]')) return;
      ['placeholder', 'title', 'aria-label', 'alt'].forEach((a) => { const v = el.getAttribute(a); if (v && en.test(v) && !ok.test(v)) out.add('@' + a + ': ' + v); });
    });
    return [...out];
  }, { src: ENGLISH.source, allow: ALLOW.source });
}

const STATUSES = [['new_application', 1, 'In review'], ['under_review', 2, 'In review'], ['feasibility_confirmed', 5, 'Approved'], ['quotation_in_progress', 6, 'Approved, preparing your quotation'],
  ['awaiting_confirmation', 7, 'Quotation sent'], ['awaiting_deposit', 8, 'Waiting for 40% deposit'], ['order_processing', 9, 'In production'], ['quality_inspection', 10, 'Quality inspection'],
  ['air_shipping', 11, 'Shipped to Morocco'], ['customs_clearance', 12, 'Arrived in Morocco, in customs clearance'], ['arrived_morocco', 13, 'Customs cleared'],
  ['awaiting_final_payment', 14, 'Waiting for 60% payment'], ['out_for_delivery', 16, 'Out for delivery'], ['completed', 17, 'Delivered'], ['refund_pending', 94, 'Refund in progress'],
  ['refunded', 95, 'Refunded'], ['cancelled_by_client', 96, 'Cancelled'], ['cancelled_by_us', 97, 'Cancelled by DDPSourcing'], ['not_qualified', 99, 'Closed']]
  .map(([code, rank, client_stage]) => ({ code, rank, label: code, client_stage }));
const PUBLIC = { termsVersion: '2026-11-v1', refundBusinessDays: 7, claimHours: 72 };
const BANK = { bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', rib: '011780000012345678901234', reference: 'DDP-0042', reference_note: '' };
const pay = (o) => Object.assign({ final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'not_due', awaiting_payment: false }, o);
const req = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'u-admin', product_name: 'Earbuds', category: 'gadget', quantity: 200, delivery_city: 'Rabat', created_at: iso(-20), updated_at: iso(-1) }, o);
const MESSAGES = [
  { id: 'm1', request_id: 'q1', from_team: true, kind: 'update', body: 'Status update: Quotation sent', created_at: iso(-3) },
  { id: 'm2', request_id: 'q1', from_team: true, kind: 'update', body: 'Inspection photos are ready (2 files). Please look at them in your account and approve shipping, or ask us a question.', created_at: iso(-2) },
  { id: 'm3', request_id: 'q1', from_team: true, kind: 'update', body: 'Refund paid: MAD 9,600.00 by bank transfer (reference VIR-1).', created_at: iso(-1.5) },
  { id: 'm6', request_id: 'q1', from_team: true, kind: 'update', body: 'Reminder: your 60% payment of MAD 14,400.00 is due. Use the bank details in your account and write DDP-0042 as the reference. A storage fee applies from 18 Nov 2026. Without payment by 11 Dec 2026, the order is cancelled and the deposit is kept (see our payment rules).', created_at: iso(-1.4) },
  { id: 'm7', request_id: 'q1', from_team: true, kind: 'update', body: 'Claim answered: refund of MAD 360.00. نعتذر عن القطع المكسورة.', created_at: iso(-1.3) },
  { id: 'm8', request_id: 'q1', from_team: true, kind: 'update', body: 'We cancelled this order: توقف المورد عن هذا المنتج. You receive a full refund of MAD 9,600.00 by bank transfer.', created_at: iso(-1.2) },
  { id: 'm9', request_id: 'q1', from_team: true, kind: 'update', body: 'Claim update: our team is reviewing your claim.', created_at: iso(-1.1) },
  { id: 'm4', request_id: 'q1', from_team: false, kind: 'message', body: 'Thank you, please send the quote', created_at: iso(-1) },
  { id: 'm5', request_id: 'q1', from_team: true, kind: 'message', body: 'Here is your quote.', created_at: iso(-0.5) }];
const MEDIA = [{ request_id: 'q1', path: 'staff/q1/inspection-1.jpg', file_name: 'a.jpg', media_type: 'image', created_at: iso(-1) },
  { request_id: 'q1', path: 'staff/q1/inspection-2.mp4', file_name: 'b.mp4', media_type: 'video', created_at: iso(-1) }];

async function arAccount(b, r, rpc, tables) {
  const x = await page(b, { emptyRequests: true, addRequests: [r], extraStatuses: STATUSES,
    extraTables: Object.assign({ request_messages: MESSAGES, inspection_media: MEDIA, claims: [] }, tables || {}),
    rpcData: Object.assign({ public_settings: PUBLIC, my_refunds: [] }, rpc || {}) });
  await x.p.goto('http://local.test/ar/account'); await x.p.waitForTimeout(1300);
  await x.p.click('.req[data-id="q1"]'); await x.p.waitForTimeout(900);
  return x;
}

(async () => {
  const b = await chromium.launch();
  const found = new Map();
  const note = (where, list) => list.forEach((t) => { if (!found.has(t)) found.set(t, where); });

  // ---------- Public pages ----------
  for (const [en, fr] of [['/', '/ar'], ['/estimate', '/ar/estimate'], ['/policies', '/ar/policies'], ['/terms', '/ar/terms'], ['/privacy', '/ar/privacy']]) {
    let { ctx, p } = await page(b, { session: null });
    await p.goto('http://local.test' + fr); await p.waitForTimeout(500);
    const info = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, font: !!document.querySelector('link[href*="family=Tajawal"]') && !!document.querySelector('link[href="/assets/rtl.css"]'), alt: [...document.querySelectorAll('link[rel=alternate]')].map((l) => l.hreflang + '=' + l.href).join(' '),
      sw: (document.querySelector('[data-lang-switch="en"]') || {}).getAttribute ? document.querySelector('[data-lang-switch="en"]').getAttribute('href') : null,
      links: [...document.querySelectorAll('a[href^="/"]:not([data-lang-switch])')].map((a) => a.getAttribute('href')).filter((h) => /^\/(account|estimate|policies|terms|privacy)?([?#]|$)/.test(h)) }));
    check(fr + ': lang ar, dir rtl, Arabic font, hreflang en/fr/ar/x-default, switch to ' + en, info.lang === 'ar' && info.dir === 'rtl' && info.font && /en=https:\/\/www\.ddpsourcing\.com/.test(info.alt) && info.alt.includes('ar=https://www.ddpsourcing.com' + fr) && info.alt.includes('fr=https://www.ddpsourcing.com/fr') && /x-default/.test(info.alt) && info.sw === en, JSON.stringify(info.alt) + ' sw=' + info.sw);
    check(fr + ': links stay in Arabic', info.links.length === 0, info.links.join(' '));
    await ctx.close();
    ({ ctx, p } = await page(b, { session: null }));
    await p.goto('http://local.test' + en); await p.waitForTimeout(300);
    check(en + ': English page offers ع', (await p.getAttribute('[data-lang-switch="ar"]', 'href')) === fr && (await p.evaluate(() => document.documentElement.lang)) === 'en');
    await ctx.close();
  }
  // Arabic rule values and company line
  let { ctx, p } = await page(b, { session: null });
  await p.goto('http://local.test/ar/policies'); await p.waitForTimeout(500);
  const pol = await p.textContent('main');
  check('ar/policies: rule words in Arabic (date, method, delivery days)', /31 أكتوبر 2026/.test(pol) && /تحويل بنكي/.test(pol) && /15 إلى 20/.test(pol) && !/bank transfer|October/.test(pol));
  check('ar footer: company line in Arabic', /خدمة تابعة لشركة Beast Capital Group/.test(await p.textContent('footer')));
  await ctx.close();
  // Arabic homepage request form
  ({ ctx, p } = await page(b, { session: null, exists: false }));
  await p.goto('http://local.test/ar'); await p.waitForTimeout(900);
  check('ar homepage: form in Arabic', /الخطوة 1 من 3/.test(await p.textContent('#stepCount')));
  check('ar homepage: phone number field stays left-to-right', (await p.evaluate(() => getComputedStyle(document.querySelector('input[type=tel]')).direction)) === 'ltr');
  await ctx.close();

  // ---------- Arabic client account ----------
  ({ ctx, p } = await page(b, { session: null }));
  await p.goto('http://local.test/ar/account'); await p.waitForTimeout(1200);
  check('ar/account: lang ar, dir rtl, title, switch to /account', (await p.evaluate(() => document.documentElement.lang + document.documentElement.dir)) === 'arrtl' && /حسابي/.test(await p.title()) && (await p.getAttribute('[data-lang-switch="en"]', 'href')) === '/account' && (await p.textContent('[data-lang-switch="en"]')) === 'EN');
  check('ar/account: public links go to Arabic pages', await p.evaluate(() => [...document.querySelectorAll('a[href]')].every((a) => !/^\/(estimate|policies|terms|privacy)([?#]|$)/.test(a.getAttribute('href')))));
  note('logged out', await leftovers(p));
  await p.evaluate(() => {
    const v = { su_name: 'Sara B', su_email: 'sara@x.ma', su_whatsapp: '0612345678', su_city: 'Rabat', su_status: 'selling', su_password: 'secret123' };
    Object.keys(v).forEach((k) => { document.getElementById(k).value = v[k]; });
    document.getElementById('signupForm').requestSubmit();
  });
  await p.waitForTimeout(500);
  const su = (await calls(p)).find((c) => c[0] === 'signUp');
  check('signup on /ar/account: language ar, confirmation link to /ar/account', su && su[1].options.data.language === 'ar' && /\/ar\/account$/.test(su[1].options.emailRedirectTo), JSON.stringify(su && su[1].options));
  await ctx.close();

  // Logged in: list, tabs
  ({ ctx, p } = await page(b, { extraStatuses: STATUSES, extraTables: { request_messages: MESSAGES } }));
  await p.goto('http://local.test/ar/account'); await p.waitForTimeout(1300);
  check('list in Arabic (stages, units, date)', /قطعة/.test(await p.textContent('#tab-requests')) && !/units/.test(await p.textContent('#tab-requests')));
  note('list', await leftovers(p));
  for (const t of ['new', 'estimate', 'reviews', 'profile']) {
    await p.click('[data-tab="' + t + '"]'); await p.waitForTimeout(300);
    note('tab ' + t, await leftovers(p));
  }
  await p.click('[data-tab="new"]'); await p.click('#reqForm button[type=submit], #nextBtn').catch(() => {}); await p.waitForTimeout(300);
  note('form errors', await leftovers(p));
  await ctx.close();

  // Order states
  const states = [
    ['quote valid', req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: iso(-1), quote_expires_at: iso(6) }), { my_payment_info: pay({ deposit_status: 'pending' }) }],
    ['quote expired', req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: iso(-9), quote_expires_at: iso(-2) }), { my_payment_info: pay({ deposit_status: 'pending' }) }],
    ['deposit due', req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'pending', awaiting_payment: true, bank: BANK }) }],
    ['deposit due, no RIB', req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'pending', awaiting_payment: true, bank: Object.assign({}, BANK, { rib: null }) }) }],
    ['proof received', req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'received', deposit_date: iso(-1), awaiting_payment: true, bank: BANK }) }],
    ['inspection to approve', req({ status: 'quality_inspection', quote_amount_mad: 24000, inspection_requested_at: iso(-0.5) }), { my_payment_info: pay({}) }],
    ['inspection approved', req({ status: 'quality_inspection', quote_amount_mad: 24000, inspection_requested_at: iso(-1), inspection_approved_at: iso(-0.2) }), { my_payment_info: pay({}) }],
    ['60% due', req({ status: 'awaiting_final_payment', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'pending', awaiting_payment: true, bank: BANK, storage_fee_from: iso(4), cancel_after: iso(27) }) }],
    ['refund approved', req({ status: 'refund_pending', quote_amount_mad: 24000, closed_kind: 'cancelled', cancelled_by: 'client', closed_reason: 'Changed my mind' }), { my_payment_info: pay({}), my_refunds: [{ amount_mad: 9600, status: 'approved', requested_at: iso(-2), approved_at: iso(-1) }] }],
    ['refund paid', req({ status: 'refunded', quote_amount_mad: 24000 }), { my_payment_info: pay({}), my_refunds: [{ amount_mad: 9600, status: 'paid', requested_at: iso(-5), approved_at: iso(-4), paid_at: iso(-1), reference: 'VIR-R1', proof_path: 'x.pdf' }, { amount_mad: 500, status: 'requested', requested_at: iso(-1) }] }],
    ['delivered, claim open window', req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), delivered_at: iso(-0.1) }],
    ['delivered, window passed', req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), delivered_at: iso(-5) }],
    ['claim answered', req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), delivered_at: iso(-1) },
      { claims: [{ id: 'k1', request_id: 'q1', units_affected: 3, description: 'Three units broken.', status: 'resolved', outcome: 'refund', refund_amount_mad: 360, created_at: iso(-0.5), files: [] }] }],
    ['declined', req({ status: 'not_qualified', closed_kind: 'declined', closed_reason: 'Too expensive' }), {}],
    ['cancelled by client', req({ status: 'cancelled_by_client', closed_kind: 'cancelled', cancelled_by: 'client', closed_reason: 'Changed my mind' }), {}],
    ['below minimum, new', req({ status: 'new_application', below_minimum: true, quantity: 20 }), {}],
    ['cancel box open', req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'received', awaiting_payment: true, bank: BANK }) }],
  ];
  for (const [name, r, rpc, tables] of states) {
    ({ ctx, p } = await arAccount(b, r, rpc, tables));
    if (name === 'cancel box open') { await p.click('#cancelOpen'); await p.click('#cancelGo'); await p.waitForTimeout(200); }
    if (name === 'delivered, claim open window') { await p.click('#claimOpen'); await p.click('#claimSend'); await p.waitForTimeout(200); }
    if (name === 'quote valid') { await p.click('#dealAccept'); await p.waitForTimeout(200); await p.click('#dealDecline'); await p.waitForTimeout(100); }
    note(name, await leftovers(p));
    if (name === 'quote valid') {
      const deal = await p.textContent('#dealBox');
      check('quote card in Arabic with Arabic dates', /عرض السعر النهائي/.test(deal) && /صالح حتى \d+ [\u0600-\u06FF]+ \d{4}/.test(deal) && /اقبل عرض السعر/.test(deal), deal.slice(0, 160));
      check('client messages are never translated', /Thank you, please send the quote/.test(await p.textContent('#chat')) && /تحديث الحالة: تم إرسال عرض السعر/.test(await p.textContent('#chat')));
      await p.click('#dealAsk'); await p.waitForTimeout(100);
      check('"Ask a question" prefills in Arabic', /^سؤال حول عرض السعر:/.test(await p.inputValue('#chatMsg')));
    }
    await ctx.close();
  }
  check('Arabic account: no English text left in ' + (states.length + 7) + ' screens', found.size === 0, [...found].map(([t, w]) => '[' + w + '] ' + t).join(' | '));

  // A client who chose Arabic is sent to the Arabic account; the switch to English is remembered.
  ({ ctx, p } = await page(b, { extraTables: { profiles: [{ id: 'u-admin', full_name: 'Sara B', email: 'sara@x.ma', language: 'ar' }] } }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1500);
  check('profile language ar: /account opens /ar/account', new URL(p.url()).pathname === '/ar/account');
  // Calls are kept in sessionStorage because the click opens another page.
  await p.evaluate(() => { const c = window.__MOCK.calls, push = c.push.bind(c); c.push = (...a) => { sessionStorage.setItem('calls', JSON.stringify(JSON.parse(sessionStorage.getItem('calls') || '[]').concat(a))); return push(...a); }; });
  await p.click('[data-lang-switch="en"]'); await p.waitForTimeout(1200);
  const upd = JSON.parse(await p.evaluate(() => sessionStorage.getItem('calls') || '[]')).find((c) => c[0] === 'update' && c[1] === 'profiles');
  check('switching to English saves language=en and opens /account', upd && upd[2].language === 'en' && new URL(p.url()).pathname === '/account', JSON.stringify(upd));
  await ctx.close();
  ({ ctx, p } = await page(b, { extraTables: { profiles: [{ id: 'u-admin', full_name: 'Sara B', email: 'sara@x.ma', language: 'ar' }] } }, null, { 'ddp-lang': 'en' }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1300);
  check('English chosen on this device: stays on /account', new URL(p.url()).pathname === '/account');
  await ctx.close();

  // English account unchanged.
  ({ ctx, p } = await page(b, {}));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1200);
  check('English account stays English', (await p.evaluate(() => document.documentElement.lang)) === 'en' && /My requests/.test(await p.textContent('body')));
  await ctx.close();

  // ---------- Right-to-left layout: nothing wider than the screen, mirrored elements on the correct side ----------
  const wide = [];
  for (const u of ['/ar', '/ar/estimate', '/ar/policies', '/ar/terms', '/ar/privacy'])
    for (const w of [360, 390, 768, 1024, 1300, 1600]) {
      ({ ctx, p } = await page(b, { session: null }, { width: w, height: 800 }));
      await p.goto('http://local.test' + u); await p.waitForTimeout(250);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w) wide.push(u + '@' + w + '=' + sw);
      await ctx.close();
    }
  for (const w of [360, 1300]) {
    ({ ctx, p } = await arAccount(b, req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'pending', awaiting_payment: true, bank: BANK }) }));
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(200);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) wide.push('/ar/account@' + w + '=' + sw);
    await ctx.close();
  }
  check('Arabic pages: no sideways scroll at 6 screen widths (and the account at 2)', wide.length === 0, wide.join(' '));
  ({ ctx, p } = await page(b, { session: null }, { width: 1300, height: 900 }));
  await p.goto('http://local.test/ar'); await p.waitForTimeout(400);
  const side = await p.evaluate(() => {
    const li = document.querySelector('.route li'), dot = li.querySelector('.dot'), line = getComputedStyle(li, '::after');
    const r = li.getBoundingClientRect(), d = dot.getBoundingClientRect();
    return { dotRight: d.right > r.left + r.width / 2, lineRight: parseFloat(line.right) < parseFloat(line.left), logoRight: document.querySelector('.logo').getBoundingClientRect().left > innerWidth / 2 };
  });
  check('mirrored: logo on the right, route dots and their line on the right', side.dotRight && side.lineRight && side.logoRight, JSON.stringify(side));
  await ctx.close();
  ({ ctx, p } = await arAccount(b, req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: iso(-1), quote_expires_at: iso(6) }), { my_payment_info: pay({ deposit_status: 'pending' }) }));
  const total = await p.textContent('#dealBox .total');
  check('amounts stay readable in right-to-left (MAD 24,000 in one piece)', /MAD 24,000/.test(total), total);
  check('request code stays left-to-right', (await p.evaluate(() => getComputedStyle(document.querySelector('.req-code')).direction)) === 'ltr');
  await ctx.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
