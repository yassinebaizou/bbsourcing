// CRM administrator tools: add a client (account + email), edit and delete a client, delete a request.
// Usage: node tests/browser/admin-clients.js [siteFolder]   (Playwright + Chromium; Supabase is mocked)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
let pre = '';
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

async function open(b, m) {
  pre = 'window.__MOCK=' + JSON.stringify(m) + ';';
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
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://local.test/team'); await p.waitForTimeout(1200);
  return { ctx, p, errors };
}
const invokes = (p) => p.evaluate(() => window.__MOCK.calls.filter((c) => c[0] === 'invoke'));

(async () => {
  const b = await chromium.launch();

  // Add a client.
  let { ctx, p, errors } = await open(b, { role: 'admin' });
  await p.click('[data-view="clients"]'); await p.waitForTimeout(300);
  check('admin sees "Add a client"', await p.isVisible('#addClientBtn'));
  await p.click('#addClientBtn'); await p.waitForTimeout(200);
  await p.fill('#cf_name', 'Karim Alaoui'); await p.fill('#cf_email', 'bad-email'); await p.click('#cfSave'); await p.waitForTimeout(200);
  check('invalid email is refused before sending', (await invokes(p)).length === 0);
  await p.fill('#cf_email', 'karim@shop.ma'); await p.fill('#cf_wa', '0612345678'); await p.selectOption('#cf_selling', 'selling');
  await p.click('#cfSave'); await p.waitForTimeout(500);
  let inv = (await invokes(p))[0];
  check('create_client sent to admin-clients with the details', inv && inv[1] === 'admin-clients' && inv[2].action === 'create_client' && inv[2].email === 'karim@shop.ma' && inv[2].full_name === 'Karim Alaoui' && inv[2].selling_status === 'selling', JSON.stringify(inv && inv[2]));
  check('success message says the login email was sent', /login email was sent/.test(await p.textContent('.toast')));

  // After creating, the new client's panel opens (the mock answers with id c1 = Sara B).
  check('the new client opens after creation', /Sara B/.test(await p.textContent('#drawerHead')));

  // Edit and delete a client (Sara B, id c1, has a completed order in the mock).
  await p.click('#closeDrawer'); await p.waitForTimeout(200);
  await p.click('#clientsBody [data-client="c1"]'); await p.waitForTimeout(300);
  check('client drawer has Edit and Delete for the admin', (await p.isVisible('#editClient')) && (await p.isVisible('#deleteClient')));
  await p.click('#editClient'); await p.waitForTimeout(200);
  check('edit form is prefilled', (await p.inputValue('#cf_name')) === 'Sara B' && (await p.inputValue('#cf_email')) === 'sara@x.ma');
  await p.fill('#cf_city', 'Tangier'); await p.click('#cfSave'); await p.waitForTimeout(400);
  inv = (await invokes(p)).find((c) => c[2].action === 'update_client');
  check('update_client sends the new city', inv && inv[2].id === 'c1' && inv[2].city === 'Tangier');
  check('after saving, the client panel shows again', await p.isVisible('#deleteClient'));
  p.once('dialog', (d) => d.accept('no')); await p.click('#deleteClient'); await p.waitForTimeout(200);
  check('delete client needs the word DELETE', !(await invokes(p)).some((c) => c[2].action === 'delete_client'));
  p.once('dialog', (d) => d.accept('DELETE')); await p.click('#deleteClient'); await p.waitForTimeout(400);
  check('delete_client sent after confirmation', (await invokes(p)).some((c) => c[2].action === 'delete_client' && c[2].id === 'c1'));
  check('no JavaScript errors (admin)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // Delete a request: refused by the server (accepted quote) shows the reason.
  ({ ctx, p, errors } = await open(b, { role: 'admin', invokeError: 'DDP-0002 cannot be deleted: it has an accepted quote. Close it as "Not qualified" instead.' }));
  await p.click('[data-view="requests"]'); await p.waitForTimeout(300);
  await p.click('#reqBody tr[data-id="r2"], tr[data-id="r2"]'); await p.waitForTimeout(500);
  check('request drawer has "Delete this request" for the admin', await p.isVisible('#deleteRequest'));
  p.once('dialog', (d) => d.accept('DDP-0002')); await p.click('#deleteRequest'); await p.waitForTimeout(400);
  inv = (await invokes(p)).find((c) => c[2].action === 'delete_request');
  check('delete_request sent after typing the code', inv && inv[2].id === 'r2');
  check('server refusal is shown to the admin', /accepted quote/.test(await p.textContent('.toast')));
  await ctx.close();

  // Agent: no admin tools.
  ({ ctx, p, errors } = await open(b, { role: 'agent' }));
  check('agent has no "Add a client"', !(await p.isVisible('#addClientBtn')));
  await p.click('[data-view="requests"]'); await p.waitForTimeout(300);
  await p.click('tr[data-id="r2"]'); await p.waitForTimeout(500);
  check('agent has no "Delete this request"', !(await p.$('#deleteRequest')));
  await ctx.close();

  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
