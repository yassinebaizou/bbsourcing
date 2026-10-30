// Sprint 1 browser checks (ROADMAP A1 page side, A2, A1 recovery in /account).
// Usage: node tests/browser/sprint1.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
// Every check prints PASS or FAIL. Run it on the old code to see the bugs, on the new code to see the fixes.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

async function newContext(b) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
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
async function fillHomeTo3(p, link, qty, withPhoto) {
  await p.goto('http://local.test/'); await p.waitForTimeout(400);
  await p.click('.header-actions a[href="#request"]'); await p.waitForTimeout(1300);
  await p.fill('#f-link', link); await p.fill('#f-prod', 'Earbuds'); await p.fill('#f-qty', String(qty));
  if (withPhoto) await p.setInputFiles('#f-img', { name: 'earbuds.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await p.click('#nextBtn');
  if (!(await p.isVisible('#step2'))) return false;
  await p.fill('#f-name', 'Sara B'); await p.fill('#f-wa', '0612345678'); await p.fill('#f-city', 'Rabat'); await p.selectOption('#f-selling', 'selling');
  await p.check('#consent-wa'); await p.check('#consent-privacy'); await p.click('#nextBtn');
  return true;
}
async function signUpNew(p) {
  await p.fill('#a-email', 'new@x.ma'); await p.click('#submitBtn'); await p.waitForTimeout(300);
  await p.fill('#a-pass', 'secret123'); await p.click('#submitBtn'); await p.waitForTimeout(500);
}
const calls = (p) => p.evaluate(() => window.__MOCK.calls);

(async () => {
  const b = await chromium.launch();
  console.log('Site folder: ' + ROOT);

  // A1 (page): a link with a space must be sent encoded, as the database requires.
  let ctx = await newContext(b); let p = await ctx.newPage();
  pre = 'window.__MOCK={session:null,exists:false};';
  await fillHomeTo3(p, 'https://www.alibaba.com/product detail/x.html', 100, false); await signUpNew(p);
  let su = (await calls(p)).find((c) => c[0] === 'signUp');
  const sentLink = su ? su[1].options.data.pending_request.product_link : '(no signup)';
  check('A1 link with a space is sent without spaces', !/\s/.test(sentLink), sentLink);
  await ctx.close();

  // A1 (page): quantity is capped at 1,000,000.
  ctx = await newContext(b); p = await ctx.newPage();
  const reached = await fillHomeTo3(p, 'https://www.alibaba.com/x', 3000000000, false);
  check('A1 quantity above 1,000,000 is refused by the form', !reached, reached ? 'form accepted it' : await p.textContent('#errors'));
  await ctx.close();

  // A2: a new visitor's photos are kept in the browser, then uploaded at first login in /account.
  ctx = await newContext(b); p = await ctx.newPage();
  pre = 'window.__MOCK={session:null,exists:false,newUserId:"u-new"};';
  await fillHomeTo3(p, 'https://www.alibaba.com/x', 300, true); await signUpNew(p);
  const saved = await p.evaluate(() => window.PendingPhotos ? window.PendingPhotos.get('u-new').then((r) => (r ? r.files.length : 0)) : 0);
  check('A2 photo kept in the browser after sign-up', saved === 1, 'files saved: ' + saved);
  check('A2 done screen does not tell the client the photos are lost', !/not uploaded yet/.test(await p.textContent('#doneText')), (await p.textContent('#doneText')).slice(0, 90));
  const p2 = await ctx.newPage();
  pre = 'window.__MOCK={session:{user:{id:"u-new",email:"new@x.ma",user_metadata:{}}},role:null,addRequests:[{id:"rNew",code:"DDP-2001",client_id:"u-new",product_name:"Earbuds",quantity:300,status:"new_application",created_at:new Date().toISOString(),client:{}}]};';
  await p2.goto('http://local.test/account'); await p2.waitForTimeout(1500);
  const c2 = await calls(p2);
  const up = c2.filter((c) => c[0] === 'upload').map((c) => c[1]);
  const fileRow = c2.find((c) => c[0] === 'insert' && c[1] === 'request_files');
  check('A2 photo uploaded at first login, into the new request', up.length === 1 && /^u-new\/rNew\//.test(up[0]) && !!fileRow, up.join(', ') || 'no upload');
  const left = await p2.evaluate(() => window.PendingPhotos ? window.PendingPhotos.get('u-new').then((r) => (r ? r.files.length : 0)) : -1);
  check('A2 browser copy removed after upload', left === 0, 'left: ' + left);
  await ctx.close();

  // A1 (account): a request the database refused at sign-up reopens prefilled on first login.
  ctx = await newContext(b); p = await ctx.newPage();
  pre = 'window.__MOCK={session:{user:{id:"u-x",email:"x@x.ma",user_metadata:{}}},role:null,emptyRequests:true,rpcData:{my_failed_request:{product_name:"Speaker",product_link:"https://www.alibaba.com/a b",quantity:250,order_type:"restock",delivery_city:"Fes",specifications:"Black"}}};';
  await p.goto('http://local.test/account'); await p.waitForTimeout(1500);
  const formOpen = await p.isVisible('#tab-new');
  const name = formOpen ? await p.inputValue('#f_name') : '';
  check('A1 lost request reopens prefilled in /account', formOpen && name === 'Speaker', formOpen ? 'name=' + name + ', qty=' + (await p.inputValue('#f_qty')) + ', message=' + (await p.textContent('#reqMsg')).slice(0, 70) : 'form not opened');
  await ctx.close();

  // A2 (account page sign-up): pictures are kept too when the visitor signs up from /account.
  ctx = await newContext(b); p = await ctx.newPage();
  pre = 'window.__MOCK={session:null,exists:false,newUserId:"u-acc"};';
  await p.goto('http://local.test/account'); await p.waitForTimeout(800);
  await p.fill('#f_link', 'https://www.alibaba.com/z'); await p.fill('#f_name', 'Bag'); await p.fill('#f_qty', '200');
  await p.setInputFiles('#f_images', { name: 'bag.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await p.click('#nextBtn'); await p.fill('#f_city', 'Rabat'); await p.check('#f_consent'); await p.check('#f_privacy'); await p.click('#nextBtn');
  await p.fill('#g_email', 'acc@x.ma'); await p.click('#sendBtn'); await p.waitForTimeout(300);
  await p.fill('#g_name', 'Ali'); await p.fill('#g_whatsapp', '0612345678'); await p.selectOption('#g_status', 'starting'); await p.fill('#g_password', 'secret123');
  await p.click('#sendBtn'); await p.waitForTimeout(700);
  const kept = await p.evaluate(() => window.PendingPhotos ? window.PendingPhotos.get('u-acc').then((r) => (r ? r.files.length : 0)) : 0);
  check('A2 /account sign-up keeps the picture too', kept === 1, (await p.textContent('#sentFileWarn')).slice(0, 80));
  await ctx.close();

  // A1 (CRM): a lost sign-up request shows under "Needs attention".
  ctx = await newContext(b); p = await ctx.newPage();
  pre = 'window.__MOCK={role:"admin",failedRows:[{id:"f1",payload:{product_name:"Speaker",quantity:250},error:"violates check",created_at:new Date().toISOString(),user:{full_name:"Karim",email:"k@x.ma",whatsapp:"+212600000000"}}]};';
  await p.goto('http://local.test/team'); await p.waitForTimeout(1200);
  const att = await p.locator('#attentionBody').innerText();
  check('A1 CRM "Needs attention" lists the lost request', /lost at sign-up/i.test(att) && /Karim/.test(att), att.split('\n').slice(0, 2).join(' / '));
  await ctx.close();

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' check(s) failed' : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
