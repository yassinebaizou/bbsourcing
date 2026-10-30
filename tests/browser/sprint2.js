// Sprint 2 checks: /policies matches the Terms, every number comes from assets/policy.js,
// no placeholder or "template" text on any page, links to /policies in place.
// Usage: node tests/browser/sprint2.js [siteFolder]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
const file = (u) => { let f = path.join(ROOT, u === '/' ? 'index.html' : u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html'; if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); return f; };
(async () => {
  const b = await chromium.launch();
  const policyFile = path.join(ROOT, 'assets/policy.js');
  check('assets/policy.js exists', fs.existsSync(policyFile));
  const used = {};
  for (const url of ['/policies', '/terms', '/privacy', '/', '/account', '/estimate']) {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
      if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: 'window.__MOCK={session:null};' + mock });
      const f = file(u.pathname); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
      r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'image/svg+xml' }); });
    const resp = await p.goto('http://local.test' + url); await p.waitForTimeout(800);
    if (resp.status() !== 200) { check(url + ' exists', false, 'HTTP ' + resp.status()); await p.close(); continue; }
    const info = await p.evaluate(() => {
      const P = window.DDP_POLICY || {};
      const spans = [...document.querySelectorAll('[data-policy]')].map((e) => ({ k: e.dataset.policy, shown: e.textContent.trim(), hidden: !!e.closest('[hidden]') }));
      const visible = document.body.innerText;
      return { P, spans, visible, links: [...document.querySelectorAll('a[href="/policies"]')].length };
    });
    // Static text (what a visitor sees before or without JavaScript) must equal the value in policy.js.
    const raw = fs.readFileSync(file(url), 'utf8');
    const stat = [...raw.matchAll(/data-policy="(\w+)">([^<]*)</g)].map((m) => ({ k: m[1], t: m[2] }));
    const badStatic = stat.filter((s) => info.P[s.k] !== null && info.P[s.k] !== undefined && String(info.P[s.k]) !== s.t);
    const badShown = info.spans.filter((s) => !s.hidden && info.P[s.k] !== null && info.P[s.k] !== undefined && s.shown !== String(info.P[s.k]));
    if (info.spans.length) check(url + ': every rule value matches policy.js', !badStatic.length && !badShown.length,
      info.spans.length + ' values' + (badStatic.length ? ', static mismatch: ' + badStatic.map((x) => x.k + '=' + x.t).join(',') : '') + (badShown.length ? ', shown mismatch: ' + badShown.map((x) => x.k).join(',') : ''));
    used[url] = new Set(info.spans.filter((s) => !s.hidden).map((s) => s.k));
    const placeholder = (info.visible.match(/\[[^\]\n]{1,40}\]/g) || []);
    check(url + ': no [placeholder] or "template" text', !placeholder.length && !/starting template/i.test(info.visible), placeholder.join(' '));
    if (['/', '/terms', '/privacy'].includes(url)) check(url + ': links to /policies', info.links > 0, info.links + ' link(s)');
    const nullHidden = info.spans.filter((s) => s.k === 'storageFeeMad').every((s) => s.hidden);
    if (info.spans.some((s) => s.k === 'storageFeeMad')) check(url + ': undecided storage-fee amount is hidden', nullHidden);
    check(url + ': no JavaScript errors', !errs.length, errs.join(' | '));
    await p.close();
  }
  // Every rule on /policies is also stated in the Terms.
  const skip = new Set(['lastUpdated', 'termsVersion']);
  const missing = [...(used['/policies'] || [])].filter((k) => !skip.has(k) && !used['/terms'].has(k));
  check('/policies: every rule also appears in the Terms', !missing.length, missing.length ? 'missing in Terms: ' + missing.join(', ') : [...used['/policies']].length + ' rules');
  await b.close();
  const failed = results.filter((x) => !x).length; console.log(failed ? failed + ' check(s) failed' : 'All checks passed'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
