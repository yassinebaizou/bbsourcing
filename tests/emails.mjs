// Sprint 6: renders every client email locally and checks its content.
// Usage: node --experimental-strip-types tests/emails.mjs [folderForHtmlPreviews]
import { buildEmail, OPTIONAL } from "../supabase/functions/notify-client/templates.ts";
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

const failed = results.filter((x) => !x).length;
console.log(failed ? failed + " FAILED" : "ALL " + results.length + " PASSED");
process.exit(failed ? 1 : 0);
