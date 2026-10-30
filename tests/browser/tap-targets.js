// Lists links and buttons shorter than 44 px on a phone (390 px wide). Usage: node tests/browser/tap-targets.js [siteFolder]
// Links inside running text are skipped (they are part of a sentence, not a tap target).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); let total = 0;
  for (const [url, pre] of [['/', 'window.__MOCK={session:null};'], ['/account', 'window.__MOCK={session:{user:{id:"c1",email:"s@x.ma",user_metadata:{}}},role:null};'], ['/estimate', ''], ['/privacy', ''], ['/terms', '']]) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
      if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
      let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); else if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'image/svg+xml' }); });
    await p.goto('http://local.test' + url); await p.waitForTimeout(900);
    if (url === '/') await p.click('#menuBtn');
    const small = await p.evaluate(() => [...document.querySelectorAll('a[href], button')].filter((e) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === 'hidden') return false;
      const inText = e.closest('p, li p, blockquote, label, .hint, .sub, .lead, .note, td') && cs.display === 'inline';
      return !inText && r.height < 43.5;
    }).map((e) => (e.textContent.trim().slice(0, 28) || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px'));
    total += small.length;
    console.log(url.padEnd(10), small.length ? small.length + ' too small: ' + small.slice(0, 12).join(' | ') : 'all ≥ 44 px');
    await p.close();
  }
  await b.close(); process.exit(total ? 1 : 0);
})();
