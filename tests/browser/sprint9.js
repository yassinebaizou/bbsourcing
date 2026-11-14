// Sprint 9 browser checks: SEO basics, consistent button names, onboarding checklist, busy buttons on a slow
// connection, and a phone pass on every page (no sideways scroll).
// Usage: node tests/browser/sprint9.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const SITE = 'https://www.ddpsourcing.com';
const results = [], errors = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const CT = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

async function page(b, m, viewport, storage) {
  const pre = 'window.__MOCK=' + JSON.stringify(m || {}) + ';';
  const ctx = await b.newContext({ viewport: viewport || { width: 1300, height: 900 } });
  if (storage) await ctx.addInitScript((s) => { Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); }, storage);
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    const p = u.pathname;  // /fr/account, /ar/account = real generated files
    let f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    else if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: CT[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);
const PUBLIC = [['', '/'], ['/estimate', '/estimate'], ['/policies', '/policies'], ['/terms', '/terms'], ['/privacy', '/privacy']];
const LANGS = ['en', 'fr', 'ar'];
const url = (lang, p) => (lang === 'en' ? (p || '/') : '/' + lang + p);

(async () => {
  const b = await chromium.launch();

  // ---------- SEO basics ----------
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  check('robots.txt: private pages blocked, sitemap announced', /Disallow: \/account/.test(robots) && /Disallow: \/team/.test(robots) && /Disallow: \/ar\/account/.test(robots) && /Sitemap: https:\/\/www\.ddpsourcing\.com\/sitemap\.xml/.test(robots) && !/Disallow: \/\s*$/m.test(robots));
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  check('sitemap.xml: 15 pages (5 × 3 languages) with their language versions', (sm.match(/<loc>/g) || []).length === 15 && (sm.match(/hreflang="x-default"/g) || []).length === 15 && sm.includes('<loc>' + SITE + '/ar/policies</loc>'));
  const seoBad = [];
  for (const lang of LANGS) for (const [p] of PUBLIC) {
    const { ctx, p: pg } = await page(b, { session: null });
    await pg.goto('http://local.test' + url(lang, p)); await pg.waitForTimeout(150);
    const h = await pg.evaluate(() => {
      const meta = (k) => (document.querySelector('meta[property="' + k + '"],meta[name="' + k + '"]') || {}).content || '';
      return { canonical: (document.querySelector('link[rel=canonical]') || {}).href, title: document.title, desc: meta('description'),
        ogTitle: meta('og:title'), ogDesc: meta('og:description'), ogUrl: meta('og:url'), ogImage: meta('og:image'), ogLocale: meta('og:locale'), card: meta('twitter:card'),
        h1: document.querySelectorAll('h1').length, robots: meta('robots') };
    });
    const want = SITE + url(lang, p), img = SITE + '/assets/og' + (lang === 'en' ? '' : '-' + lang) + '.png';
    const loc = { en: 'en_US', fr: 'fr_FR', ar: 'ar_MA' }[lang];
    const probs = [];
    if (h.canonical !== want) probs.push('canonical ' + h.canonical);
    if (h.ogUrl !== want) probs.push('og:url ' + h.ogUrl);
    if (h.ogImage !== img) probs.push('og:image ' + h.ogImage);
    if (h.ogLocale !== loc) probs.push('og:locale ' + h.ogLocale);
    if (!h.title || !h.desc || !h.ogTitle || !h.ogDesc || h.card !== 'summary_large_image') probs.push('missing title/description/og text');
    if (h.h1 !== 1) probs.push(h.h1 + ' h1');
    if (/noindex/.test(h.robots)) probs.push('noindex');
    if (lang !== 'en' && /^(Source from China|DDPSourcing: DDP|Price Estimator|Payments, Cancellation|Terms of Service \||Privacy Policy \|)/.test(h.title + h.ogTitle)) probs.push('English title');
    if (probs.length) seoBad.push(url(lang, p) + ': ' + probs.join(', '));
    await ctx.close();
  }
  check('every public page (3 languages): canonical, og:url, og:image and locale of its language, title, description, one h1', seoBad.length === 0, seoBad.join(' | '));
  for (const f of ['og.png', 'og-fr.png', 'og-ar.png']) {
    const buf = fs.readFileSync(path.join(ROOT, 'assets', f));
    check('assets/' + f + ' is a 1200×630 image', buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630);
  }
  let { ctx, p } = await page(b, { session: null });
  await p.goto('http://local.test/'); await p.waitForTimeout(200);
  const ld = await p.evaluate(() => { try { return JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (e) { return null; } });
  check('structured data: Organization (DDPSourcing, Casablanca, email) and WebSite', ld && ld['@graph'] && ld['@graph'].some((x) => x['@type'] === 'Organization' && x.name === 'DDPSourcing' && x.address.addressLocality === 'Casablanca' && x.email === 'contact@ddpsourcing.com') && ld['@graph'].some((x) => x['@type'] === 'WebSite'));
  for (const priv of ['/account', '/team']) {
    const html = fs.readFileSync(path.join(ROOT, priv.slice(1), 'index.html'), 'utf8');
    check(priv + ': noindex', /<meta name="robots" content="noindex/.test(html));
  }

  // ---------- Consistent button names ----------
  const cta = await p.evaluate(() => [...document.querySelectorAll('a[href="#request"].btn')].map((a) => a.textContent.trim()));
  check('homepage: every button to the request form says "Submit sourcing request"', cta.length >= 5 && cta.every((t) => t === 'Submit sourcing request'), cta.join(' / '));
  const est = await p.evaluate(() => [...document.querySelectorAll('a[href="/estimate"]')].map((a) => a.textContent.trim()));
  check('homepage: every link to the estimator says "Get estimated price"', est.length >= 2 && est.every((t) => t === 'Get estimated price'), est.join(' / '));
  await ctx.close();

  // ---------- Onboarding checklist ----------
  const prof = (o) => [Object.assign({ id: 'u-admin', full_name: 'Sara B', email: 'sara@x.ma', whatsapp: '', city: '' }, o)];
  ({ ctx, p } = await page(b, { client: true, emptyRequests: true, extraTables: { profiles: prof({}) } }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1300);
  const ob = await p.textContent('#onboard');
  check('new client sees "Get started" with 3 steps, 0 done', /Get started/.test(ob) && /0 of 3 done/.test(ob) && (await p.$$('#onboard li')).length === 3, ob.slice(0, 120));
  await p.click('#onboard [data-step="1"]'); await p.waitForTimeout(300);
  check('"Send your first sourcing request" opens the request form', await p.isVisible('#tab-new'));
  await ctx.close();
  ({ ctx, p } = await page(b, { client: true, extraTables: { profiles: prof({ whatsapp: '+212612345678', city: 'Rabat' }) } }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1300);
  check('profile done and a request sent: 2 of 3 done, ticked', /2 of 3 done/.test(await p.textContent('#onboard')) && (await p.$$('#onboard li.done')).length === 2);
  await p.click('#onboardHide'); await p.waitForTimeout(100);
  check('"Hide" removes the checklist and remembers it', (await p.textContent('#onboard')) === '' && (await p.evaluate(() => localStorage.getItem('ddp-onboarding-hidden'))) === '1');
  await ctx.close();
  ({ ctx, p } = await page(b, { client: true, extraTables: { profiles: prof({ whatsapp: '+212612345678', city: 'Rabat' }) } }, null, { 'ddp-read-rules': '1' }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1300);
  check('all 3 steps done: no checklist', (await p.textContent('#onboard')) === '');
  await ctx.close();
  ({ ctx, p } = await page(b, { emptyRequests: true, extraTables: { profiles: prof({}) } }));
  await p.goto('http://local.test/account'); await p.waitForTimeout(1300);
  check('team members do not see the client checklist', (await p.textContent('#onboard')) === '');
  await ctx.close();
  ({ ctx, p } = await page(b, { client: true, emptyRequests: true, extraTables: { profiles: prof({}) } }));
  await p.goto('http://local.test/ar/account'); await p.waitForTimeout(1500);
  check('checklist in Arabic on /ar/account', /لنبدأ/.test(await p.textContent('#onboard')) && /0 من 3 مكتملة/.test(await p.textContent('#onboard')));
  await ctx.close();

  // ---------- Busy buttons on a slow connection (every answer takes 1.5 s) ----------
  const STATUSES = [['awaiting_confirmation', 7, 'Quotation sent'], ['awaiting_deposit', 8, 'Waiting for 40% deposit'], ['quality_inspection', 10, 'Quality inspection'], ['completed', 17, 'Delivered']]
    .map(([code, rank, client_stage]) => ({ code, rank, label: code, client_stage }));
  const PUB = { termsVersion: '2026-11-v1', refundBusinessDays: 7, claimHours: 72 };
  const BANK = { bank_name: 'CFG Bank', account_holder: 'Beast Capital Group', rib: '011780000012345678901234', reference: 'DDP-0042', reference_note: '' };
  const pay = (o) => Object.assign({ final_price_mad: 24000, deposit_amount_mad: 9600, balance_amount_mad: 14400, deposit_status: 'verified', final_status: 'not_due' }, o);
  const req = (o) => Object.assign({ id: 'q1', code: 'DDP-0042', client_id: 'u-admin', product_name: 'Earbuds', quantity: 200, delivery_city: 'Rabat', created_at: iso(-20), updated_at: iso(-1) }, o);
  const slow = async (r, rpc, tables) => {
    const x = await page(b, { emptyRequests: true, addRequests: [r], extraStatuses: STATUSES, extraTables: Object.assign({ inspection_media: [{ request_id: 'q1', path: 'staff/q1/i.jpg', file_name: 'i.jpg', media_type: 'image', created_at: iso(-1) }], claims: [] }, tables || {}), rpcData: Object.assign({ public_settings: PUB, my_refunds: [] }, rpc || {}) });
    await x.p.goto('http://local.test/account'); await x.p.waitForTimeout(1300);
    await x.p.click('.req[data-id="q1"]'); await x.p.waitForTimeout(1000);
    await x.p.evaluate(() => { window.__MOCK.delay = 1500; });
    return x;
  };
  const busyBad = [];
  const expectBusy = async (pg, sel, name) => {
    await pg.waitForTimeout(150);
    const st = await pg.evaluate((s) => { const e = document.querySelector(s); return e ? { d: e.disabled, t: e.textContent.trim() } : null; }, sel);
    if (!st || !st.d) busyBad.push(name + (st ? ' (not disabled: ' + st.t + ')' : ' (button gone)'));
  };
  const file = (name, type) => ({ name, mimeType: type, buffer: Buffer.from('ffd8ffe000104a464946', 'hex') });
  // Accept the quote
  ({ ctx, p } = await slow(req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: iso(-1), quote_expires_at: iso(6) }), { my_payment_info: pay({ deposit_status: 'pending' }) }));
  await p.check('#dealTerms'); await p.click('#dealAccept'); await expectBusy(p, '#dealAccept', 'Accept the quote');
  await ctx.close();
  // Decline
  ({ ctx, p } = await slow(req({ status: 'awaiting_confirmation', quote_amount_mad: 24000, quote_sent_at: iso(-1), quote_expires_at: iso(6) }), { my_payment_info: pay({ deposit_status: 'pending' }) }));
  await p.click('#dealDecline'); await p.fill('#declineWhy', 'Too expensive'); await p.click('#declineGo'); await expectBusy(p, '#declineGo', 'Decline this quote');
  await ctx.close();
  // Transfer proof, then cancel, then chat
  ({ ctx, p } = await slow(req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'pending', awaiting_payment: true, bank: BANK }) }));
  await p.setInputFiles('#proofFile', file('proof.jpg', 'image/jpeg')); await p.click('#proofSend'); await expectBusy(p, '#proofSend', 'Send the transfer proof');
  await p.evaluate(() => { window.__MOCK.delay = 0; }); await p.waitForTimeout(1700); await p.evaluate(() => { window.__MOCK.delay = 1500; });
  if (await p.$('#cancelOpen')) { await p.click('#cancelOpen'); await p.fill('#cancelWhy', 'Changed my mind'); await p.click('#cancelGo'); await expectBusy(p, '#cancelGo', 'Cancel this request'); }
  await ctx.close();
  ({ ctx, p } = await slow(req({ status: 'awaiting_deposit', quote_amount_mad: 24000 }), { my_payment_info: pay({ deposit_status: 'pending', awaiting_payment: true, bank: BANK }) }));
  await p.fill('#chatMsg', 'Hello'); await p.click('#chatSend'); await expectBusy(p, '#chatSend', 'Send (conversation)');
  await ctx.close();
  // Approve the inspection
  ({ ctx, p } = await slow(req({ status: 'quality_inspection', quote_amount_mad: 24000, inspection_requested_at: iso(-0.5) }), { my_payment_info: pay({}) }));
  await p.click('#inspApprove'); await expectBusy(p, '#inspApprove', 'Approve shipping');
  await ctx.close();
  // Claim
  ({ ctx, p } = await slow(req({ status: 'completed', quote_amount_mad: 24000 }), { my_payment_info: pay({ final_status: 'verified' }), delivered_at: iso(-0.1) }));
  await p.click('#claimOpen'); await p.fill('#claimUnits', '3'); await p.fill('#claimText', 'Three units arrived broken.'); await p.setInputFiles('#claimFiles', file('c.jpg', 'image/jpeg'));
  await p.click('#claimSend'); await expectBusy(p, '#claimSend', 'Send my claim');
  await ctx.close();
  // Profile, review, estimate, log in
  ({ ctx, p } = await page(b, { extraTables: { profiles: prof({ whatsapp: '+212612345678', city: 'Rabat' }) } }));
  await p.goto('http://local.test/account?tab=profile'); await p.waitForTimeout(1300); await p.evaluate(() => { window.__MOCK.delay = 1500; });
  await p.click('#profileForm button[type=submit]'); await expectBusy(p, '#profileForm button[type=submit]', 'Save profile');
  await p.evaluate(() => { window.__MOCK.delay = 0; }); await p.waitForTimeout(1700);
  await p.click('[data-tab="reviews"]'); await p.fill('#rv_headline', 'Great order'); await p.fill('#rv_body', 'Everything arrived on time and well packed.'); await p.fill('#rv_name', 'Sara B.'); await p.check('#rv_consent');
  await p.evaluate(() => { window.__MOCK.delay = 1500; }); await p.click('#rvSend'); await expectBusy(p, '#rvSend', 'Send my review');
  await ctx.close();
  ({ ctx, p } = await page(b, { session: null, delay: 1500 }));
  await p.goto('http://local.test/account?login'); await p.waitForTimeout(1300);
  await p.evaluate(() => { const f = document.getElementById('loginForm'); f.hidden = false; f.querySelector('input[type=email]').value = 'sara@x.ma'; f.querySelector('input[type=password]').value = 'secret123'; });
  await p.evaluate(() => document.getElementById('loginForm').requestSubmit());
  await expectBusy(p, '#loginForm button[type=submit]', 'Log in');
  await ctx.close();
  check('every action button is locked while the server answers (10 actions on a slow connection)', busyBad.length === 0, busyBad.join(' | '));

  // ---------- Phone pass: no page wider than the screen ----------
  const wide = [];
  const fits = async (pg, label, w) => { const sw = await pg.evaluate(() => document.documentElement.scrollWidth); if (sw > w) wide.push(label + '@' + w + '=' + sw); };
  for (const w of [360, 390, 768]) {
    for (const lang of LANGS) for (const [pp] of PUBLIC) {
      ({ ctx, p } = await page(b, { session: null }, { width: w, height: 800 }));
      await p.goto('http://local.test' + url(lang, pp)); await p.waitForTimeout(150);
      await fits(p, url(lang, pp), w); await ctx.close();
    }
    for (const lang of LANGS) {
      ({ ctx, p } = await page(b, { session: null }, { width: w, height: 800 }));
      await p.goto('http://local.test' + url(lang, '/account')); await p.waitForTimeout(900);
      await fits(p, url(lang, '/account') + ' (logged out)', w); await ctx.close();
      ({ ctx, p } = await page(b, {}, { width: w, height: 800 }));
      await p.goto('http://local.test' + url(lang, '/account')); await p.waitForTimeout(1100);
      await fits(p, url(lang, '/account') + ' (requests)', w);
      for (const t of ['new', 'estimate', 'reviews', 'profile']) { await p.click('[data-tab="' + t + '"]').catch(() => {}); await p.waitForTimeout(150); await fits(p, url(lang, '/account') + ' tab ' + t, w); }
      await ctx.close();
    }
    ({ ctx, p } = await page(b, {}, { width: w, height: 800 }));
    await p.goto('http://local.test/team'); await p.waitForTimeout(1300);
    await fits(p, '/team dashboard', w);
    for (const v of ['requests', 'clients', 'payments']) {
      if (await p.evaluate((x) => { const e = document.querySelector('[data-view="' + x + '"]'); if (!e) return false; e.click(); return true; }, v)) { await p.waitForTimeout(250); await fits(p, '/team ' + v, w); }
    }
    await ctx.close();
  }
  check('phone and tablet: no sideways scroll on any page (public × 3 languages, account × 3 languages, CRM)', wide.length === 0, wide.join(' '));

  check('no JavaScript errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
