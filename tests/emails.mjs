// Sprint 6–8: renders every client email (English, French, Arabic) locally and checks its content.
// Usage: node --experimental-strip-types tests/emails.mjs [folderForHtmlPreviews]
import { buildEmail, OPTIONAL } from "../supabase/functions/notify-client/templates.ts";
import { frBody, STAGES_FR } from "../supabase/functions/notify-message/fr.ts";
import { arBody, STAGES_AR } from "../supabase/functions/notify-message/ar.ts";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  — " + detail : "")); };
const base = {
  client: { full_name: "Sara <b>Benali</b>" },
  request: { code: "DDP-1042", product_name: "Earbuds & case", quantity: 200, quote_amount_mad: 24000, quote_expires_at: "2026-11-20T12:00:00Z" },
  payment: { deposit_amount_mad: 9600, balance_amount_mad: 14400, final_due_at: "2026-12-01T10:00:00Z" },
  refund: { amount_mad: 9600, reference: "VIR-778" },
  settings: { claim_hours: 48, storage_fee_after_days: 7 },
  inspectionFiles: 3,
};
const KINDS = ["request_received", "quote_ready", "quote_expiring", "deposit_verified", "inspection_ready", "shipped", "final_due", "delivered", "refund_paid"];
const mails = {};
for (const kind of KINDS) {
  const m = buildEmail({ ...base, kind });
  mails[kind] = m;
  const all = m ? m.subject + m.html + m.text : "";
  check(kind + ": renders with subject, html and text", m && m.subject && m.html.length > 500 && m.text.length > 40);
  check(kind + ": no undefined/NaN/null, client name escaped", m && !/undefined|NaN|\bnull\b/.test(all) && !/<b>Benali/.test(m.html) && /Hello Sara/.test(m.html));
  check(kind + ": brand, code and a button to the account", m && /SOURCING/.test(m.html) && /DDP-1042/.test(m.subject + m.html) && /href="https:\/\/www\.ddpsourcing\.com\/account/.test(m.html));
  check(kind + ": product name escaped", m && /Earbuds &amp; case/.test(m.html) && !/Earbuds & case/.test(m.html));
  check(kind + (OPTIONAL.includes(kind) ? ": optional, says how to turn it off" : ": essential, no turn-off link"),
    m && (OPTIONAL.includes(kind) === /account\?tab=profile/.test(m.html)));
  if (out && m) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, kind + ".html"), m.html); }
}
check("unknown kind returns nothing", buildEmail({ ...base, kind: "spam" }) === null);
check("optional emails are request received and shipped", OPTIONAL.join() === "request_received,shipped");
check("quote ready: total, per unit, 40%, expiry", /MAD 24,000/.test(mails.quote_ready.html) && /MAD 120/.test(mails.quote_ready.html) && /MAD 9,600/.test(mails.quote_ready.html) && /20 November 2026/.test(mails.quote_ready.html));
check("quote expiring: subject has the date", /expires on 20 November 2026/.test(mails.quote_expiring.subject));
check("deposit verified: deposit and balance", /MAD 9,600/.test(mails.deposit_verified.html) && /MAD 14,400/.test(mails.deposit_verified.html));
check("inspection: number of files and Approve shipping", /3 photos/.test(mails.inspection_ready.html) && /Approve shipping/.test(mails.inspection_ready.html));
check("final due: 60% amount, reference, storage-fee date from settings", /MAD 14,400/.test(mails.final_due.html) && /8 December 2026/.test(mails.final_due.html) && /\/policies/.test(mails.final_due.html));
check("delivered: claim window from settings and review link", /48 hours/.test(mails.delivered.html) && /account\?tab=reviews/.test(mails.delivered.html));
check("refund paid: amount and reference", /MAD 9,600/.test(mails.refund_paid.html) && /VIR-778/.test(mails.refund_paid.html));
const bare = buildEmail({ kind: "final_due", client: {}, request: { code: "DDP-1", product_name: "X" }, payment: null, settings: null });
check("missing data: no crash, no empty rows, generic hello", bare && /Hello,/.test(bare.html) && !/undefined|NaN/.test(bare.html + bare.text) && !/storage fee/.test(bare.html));

// ---------- French (Sprint 7) ----------
const EN_WORDS = /(?<!\p{L})(the|your|you|our|we|and|with|this|is|are|to|of|order|request|quote|payment|deposit|please|days|hours|before|after|delivery|refund|claim|account|review|paid|sent)(?!\p{L})/iu;
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
for (const kind of KINDS) {
  const m = buildEmail({ ...base, kind, lang: "fr" });
  const words = m ? (m.subject + " " + strip(m.html) + " " + m.text).replace(/Earbuds|Sara|Benali|https?:\S+/g, "") : "";
  check("fr " + kind + ": French subject, html and text, no English left", m && /Bonjour Sara/.test(m.html) && !EN_WORDS.test(words), m && (words.match(EN_WORDS) || [""])[0]);
  check("fr " + kind + ": links to the French account", m && /href="https:\/\/www\.ddpsourcing\.com\/fr\/account/.test(m.html) && !/ddpsourcing\.com\/account/.test(m.html + m.text));
  if (out && m) fs.writeFileSync(path.join(out, "fr-" + kind + ".html"), m.html);
}
const frq = buildEmail({ ...base, kind: "quote_ready", lang: "fr" }), frf = buildEmail({ ...base, kind: "final_due", lang: "fr" });
check("fr amounts and dates written the French way", /24 000 MAD/.test(frq.html) && /20 novembre 2026/.test(frq.html) && /8 décembre 2026/.test(frf.html) && /\/fr\/policies/.test(frf.html));
check("fr optional emails link to the French profile", /\/fr\/account\?tab=profile/.test(buildEmail({ ...base, kind: "shipped", lang: "fr" }).html));
check("unknown languages fall back to English", /Your quote is ready/.test(buildEmail({ ...base, kind: "quote_ready", lang: "de" }).subject));

const SYSTEM = [
  "Status update: Quotation sent",
  "Reminder: your 60% payment of MAD 14,400.00 is due. Use the bank details in your account and write DDP-1042 as the reference. A storage fee applies from 18 Nov 2026. Without payment by 11 Dec 2026, the order is cancelled and the deposit is kept (see our payment rules).",
  "Reminder: your 60% payment of MAD 14,400.00 is due. Use the bank details in your account and write DDP-1042 as the reference. Without payment by 11 Dec 2026, the order is cancelled and the deposit is kept (see our payment rules).",
  "Refund paid: MAD 9,600.00 by bank transfer (reference VIR-1).",
  "Claim answered: refund of MAD 360.00.",
  "Claim answered: credit on your next order. Merci.",
  "Claim answered: claim not accepted.",
  "Claim update: our team is reviewing your claim.",
  "We cancelled this order: Le fournisseur a arrêté. You receive a full refund of MAD 9,600.00 by bank transfer.",
  "Inspection photos are ready (3 files). Please look at them in your account and approve shipping, or ask us a question.",
];
for (const sys of SYSTEM) {
  const fr = frBody(sys);
  check("fr system message: " + sys.slice(0, 40) + "…", fr !== sys && !EN_WORDS.test(fr.replace(/VIR-1|DDP-1042/g, "")), fr);
}
check("fr money and dates in reminders", /14 400 MAD/.test(frBody(SYSTEM[1])) && /18 nov\. 2026/.test(frBody(SYSTEM[1])) && /11 déc\. 2026/.test(frBody(SYSTEM[1])));
check("fr unknown text is left as written", frBody("Hello from the team") === "Hello from the team");
const stagesInDb = ["In review", "Approved", "Approved, preparing your quotation", "Quotation sent", "Waiting for 40% deposit", "In production", "Quality inspection", "Shipped to Morocco", "Arrived in Morocco, in customs clearance", "Customs cleared", "Waiting for 60% payment", "Out for delivery", "Delivered", "Refund in progress", "Refunded", "Cancelled", "Cancelled by DDPSourcing", "Closed"];
const acct = JSON.parse(fs.readFileSync(new URL("../assets/i18n/fr.json", import.meta.url), "utf8"));
check("every stage has the same French name in emails and in the account", stagesInDb.every((st) => STAGES_FR[st] && STAGES_FR[st] === acct[st]), stagesInDb.filter((st) => STAGES_FR[st] !== acct[st]).join(", "));

// ---------- Arabic (Sprint 8) ----------
const LATIN_WORDS = /(?<!\p{L})(the|your|you|our|we|and|with|this|is|are|to|of|order|request|quote|payment|deposit|please|days|hours|before|after|delivery|refund|claim|account|review|paid|sent|bonjour|votre|devis)(?!\p{L})/iu;
for (const kind of KINDS) {
  const m = buildEmail({ ...base, kind, lang: "ar" });
  const words = m ? (m.subject + " " + strip(m.html) + " " + m.text).replace(/Earbuds|Sara|Benali|https?:\S+/g, "") : "";
  check("ar " + kind + ": Arabic, right-to-left, no English left", m && /مرحبًا Sara/.test(m.html) && /dir="rtl"/.test(m.html) && /text-align:right/.test(m.html) && !LATIN_WORDS.test(words), m && (words.match(LATIN_WORDS) || [""])[0]);
  check("ar " + kind + ": links to the Arabic account", m && /href="https:\/\/www\.ddpsourcing\.com\/ar\/account/.test(m.html) && !/ddpsourcing\.com\/(fr\/)?account/.test(m.html + m.text));
  if (out && m) fs.writeFileSync(path.join(out, "ar-" + kind + ".html"), m.html);
}
const arq = buildEmail({ ...base, kind: "quote_ready", lang: "ar" }), arf = buildEmail({ ...base, kind: "final_due", lang: "ar" });
check("ar amounts in dirhams and Moroccan month names", /24,000 درهم/.test(arq.html) && /9,600 درهم/.test(arq.html) && /20 نونبر 2026/.test(arq.html) && /8 دجنبر 2026/.test(arf.html) && /\/ar\/policies/.test(arf.html), (arq.html.match(/\d+ [\u0600-\u06FF]+ 2026/) || [""])[0]);
for (const sys of SYSTEM) {
  const ar = arBody(sys);
  check("ar system message: " + sys.slice(0, 40) + "…", ar !== sys && !LATIN_WORDS.test(ar.replace(/VIR-1|DDP-1042/g, "")), ar);
}
check("ar money and dates in reminders", /14,400 درهم/.test(arBody(SYSTEM[1])) && /18 نونبر 2026/.test(arBody(SYSTEM[1])) && /11 دجنبر 2026/.test(arBody(SYSTEM[1])), arBody(SYSTEM[1]));
const acctAr = JSON.parse(fs.readFileSync(new URL("../assets/i18n/ar.json", import.meta.url), "utf8"));
check("every stage has the same Arabic name in emails and in the account", stagesInDb.every((st) => STAGES_AR[st] && STAGES_AR[st] === acctAr[st]), stagesInDb.filter((st) => STAGES_AR[st] !== acctAr[st]).join(", "));

const failed = results.filter((x) => !x).length;
console.log(failed ? failed + " FAILED" : "ALL " + results.length + " PASSED");
process.exit(failed ? 1 : 0);
