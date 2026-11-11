// Draws the link-preview images (og:image, 1200×630) shown when a page is shared on WhatsApp, Facebook, LinkedIn…
//   node tools/og/make-og.js   →  assets/og.png, assets/og-fr.png, assets/og-ar.png
// Text = the homepage promise in each language. Run again only if the promise or the brand changes.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CARDS = {
  en: { file: 'og.png', dir: 'ltr', title: 'Source from China.<br>One final price.<br>Delivered to your door.', sub: 'Express air in 15 to 20 days · Customs handled · Anywhere in Morocco' },
  fr: { file: 'og-fr.png', dir: 'ltr', title: 'Achetez en Chine.<br>Un seul prix final.<br>Livré à votre porte.', sub: 'Avion express en 15 à 20 jours · Douane gérée · Partout au Maroc' },
  ar: { file: 'og-ar.png', dir: 'rtl', title: 'استورد من الصين.<br>سعر نهائي واحد.<br>توصيل حتى بابك.', sub: 'شحن جوي سريع خلال 15 إلى 20 يومًا · الجمارك علينا · في أي مكان بالمغرب' },
};
const html = (c) => `<!doctype html><html dir="${c.dir}"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=Tajawal:wght@500;800&display=swap" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0B1220;color:#F7F8FA;font-family:${c.dir === 'rtl' ? "'Tajawal'," : ''}'Archivo',Arial,sans-serif;padding:70px 80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}
.logo{direction:ltr;display:flex;align-items:baseline;gap:12px;${c.dir === 'rtl' ? 'justify-content:flex-end' : ''}}
.logo b{font-family:'Archivo',Arial,sans-serif;font-size:56px;font-weight:900;letter-spacing:-1px}
.logo span{font-family:'Archivo',Arial,sans-serif;font-size:18px;font-weight:800;color:#FF6B00;letter-spacing:9px}
h1{font-size:${c.dir === 'rtl' ? 70 : 66}px;line-height:1.12;font-weight:800;letter-spacing:${c.dir === 'rtl' ? 0 : -1.5}px}
p{font-size:28px;color:#AEB8C8;font-weight:600}
.bar{position:absolute;bottom:0;${c.dir === 'rtl' ? 'right' : 'left'}:0;width:100%;height:12px;background:#FF6B00}
</style></head><body><div class="logo"><b>DDP</b><span>SOURCING</span></div><h1>${c.title}</h1><p>${c.sub}</p><div class="bar"></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const c of Object.values(CARDS)) {
    await p.setContent(html(c), { waitUntil: 'networkidle' }).catch(() => {});
    await p.evaluate(() => document.fonts && document.fonts.ready);
    await p.screenshot({ path: path.join(ROOT, 'assets', c.file), type: 'png' });
    console.log('wrote assets/' + c.file);
  }
  await b.close();
})();
