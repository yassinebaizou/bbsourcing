// Sprint 6 browser checks: email preferences in the client profile, ?tab=profile link from the emails.
// Usage: node tests/browser/sprint6.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
// The emails themselves are checked by: node --experimental-strip-types tests/emails.mjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [], errors = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const CT = { '.json': 'application/json', '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

async function page(b, m, viewport) {
  pre = 'window.__MOCK=' + JSON.stringify(m || {}) + ';';
  const ctx = await b.newContext({ viewport: viewport || { width: 1300, height: 900 } });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'local.test') return r.fulfill({ status: 200, body: '' });
    if (u.pathname === '/assets/vendor/supabase.js') return r.fulfill({ contentType: 'application/javascript', body: pre + mock });
    let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : /^\/(fr|ar)\/account$/.test(u.pathname) ? '/account/index.html' : u.pathname);  // vercel.json rewrites
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: CT[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);
const me = (o) => [Object.assign({ id: 'u-admin', full_name: 'Sara Benali', email: 'sara@x.ma', whatsapp: '+212612345678', city: 'Rabat' }, o)];

(async () => {
  const b = await chromium.launch();

  // Link "turn off these emails" opens the profile; defaults: step emails on, English.
  let { ctx, p } = await page(b, { extraTables: { profiles: me({}) } });
  await p.goto('http://local.test/account?tab=profile'); await p.waitForTimeout(1200);
  check('account?tab=profile opens My profile', await p.isVisible('#tab-profile'));
  check('emails box explains what is always sent', /Important emails are always sent/.test(await p.textContent('#emailPrefs')));
  check('default: step-by-step emails on, English', (await p.isChecked('#p_updates')) && (await p.inputValue('#p_language')) === 'en');
  await p.uncheck('#p_updates'); await p.selectOption('#p_language', 'fr');
  await p.click('#profileForm button[type=submit]'); await p.waitForTimeout(400);
  const up = (await calls(p)).find((c) => c[0] === 'update' && c[1] === 'profiles');
  check('saving sends email_updates=false and language=fr', up && up[2].email_updates === false && up[2].language === 'fr' && up[2].full_name === 'Sara Benali', JSON.stringify(up && up[2]));
  await ctx.close();

  // A client who turned the emails off sees the box unchecked and their language (Arabic: the account opens in Arabic, Sprint 8).
  ({ ctx, p } = await page(b, { extraTables: { profiles: me({ email_updates: false, language: 'ar' }) } }));
  await p.goto('http://local.test/account?tab=profile'); await p.waitForTimeout(2500);
  check('saved choice shown: off, Arabic (opened in /ar/account)', new URL(p.url()).pathname === '/ar/account' && !(await p.isChecked('#p_updates')) && (await p.inputValue('#p_language')) === 'ar');
  await ctx.close();

  // Phone: the emails box fits the screen.
  ({ ctx, p } = await page(b, { extraTables: { profiles: me({}) } }, { width: 375, height: 800 }));
  await p.goto('http://local.test/account?tab=profile'); await p.waitForTimeout(1200);
  const w = await p.evaluate(() => ({ box: document.getElementById('emailPrefs').getBoundingClientRect().right, page: document.documentElement.scrollWidth }));
  check('phone: emails box fits, no sideways scroll', w.box <= 375 && w.page <= 375, JSON.stringify(w));
  await ctx.close();

  check('no JavaScript errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
