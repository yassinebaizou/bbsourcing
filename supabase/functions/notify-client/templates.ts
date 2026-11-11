// Branded client emails (English; French and Arabic come in Sprints 7 and 8, using profiles.language).
// Pure functions: no database, no network, so tests/emails.mjs can render every email locally.

export const SITE = "https://www.ddpsourcing.com";
export const OPTIONAL = ["request_received", "shipped"];  // the client can turn these off in their profile

export type EmailData = {
  kind: string;
  client: { full_name?: string | null };
  request: { code: string; product_name: string; quantity?: number | null; quote_amount_mad?: number | null; quote_expires_at?: string | null };
  payment?: { deposit_amount_mad?: number | null; balance_amount_mad?: number | null; final_due_at?: string | null } | null;
  refund?: { amount_mad?: number | null; reference?: string | null } | null;
  settings?: { claim_hours?: number | null; storage_fee_after_days?: number | null } | null;
  inspectionFiles?: number;
};

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mad = (n: unknown) =>
  "MAD " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Casablanca" }) : "";
const addDays = (iso: string | null | undefined, d: number) => (iso ? new Date(new Date(iso).getTime() + d * 864e5).toISOString() : null);

function layout(label: string, title: string, body: string, button: string, link: string, foot: string) {
  return `<div style="margin:0;padding:24px 12px;background:#F7F8FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B1220;padding:18px 24px"><span style="font-size:20px;font-weight:800;color:#fff">DDP</span><span style="font-size:10px;font-weight:700;color:#FF6B00;letter-spacing:4px;margin-left:6px">SOURCING</span></td></tr>
<tr><td style="padding:26px 24px 8px">
<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#B04600">${label}</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0B1220">${title}</h1>
${body}
<p style="margin:22px 0 0"><a href="${link}" style="display:inline-block;background:#FF6B00;color:#0B1220;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">${button}</a></p>
<p style="margin:18px 0 24px;font-size:12.5px;line-height:1.5;color:#64748B">${foot}</p>
</td></tr></table></div>`;
}
const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#334155">${html}</p>`;
function rows(list: [string, string][]) {
  const r = list.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:7px 14px 7px 0;color:#64748B;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;font-size:15px;font-weight:700;color:#0B1220">${esc(v)}</td></tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px">${r}</table>`;
}

export function buildEmail(d: EmailData): { subject: string; html: string; text: string } | null {
  const q = d.request, pay = d.payment || {}, s = d.settings || {};
  const first = String(d.client.full_name || "").trim().split(" ")[0];
  const hiText = first ? `Hello ${first},` : "Hello,";
  const hi = esc(hiText);
  const label = `Your request ${esc(q.code)} · ${esc(q.product_name)}`;
  const optionalFoot = `You receive this email for each step of your order. You can turn off these step-by-step emails in <a href="${SITE}/account?tab=profile" style="color:#B04600">your profile</a>.`;
  const foot = "Questions? Reply in your client account, or answer this email.";
  const account = `${SITE}/account`;
  const qty = q.quantity ? Number(q.quantity).toLocaleString("en-US") + " units" : "";
  let subject = "", title = "", body = "", button = "Open my account", link = account, footer = foot, text = "";

  switch (d.kind) {
    case "request_received":
      subject = `We received your request ${q.code}`;
      title = "We received your sourcing request";
      body = p(`${hi} thank you. Our team reviews your request and replies on WhatsApp the same business day (Monday to Friday, 10:00–18:00).`) +
        rows([["Request", q.code], ["Product", q.product_name], ["Quantity", qty]]) +
        p("Next step: we check the product with our suppliers, then send you a written quote with one final price, delivered to your door. Nothing is paid before you accept it.");
      button = "Follow my request";
      footer = optionalFoot;
      text = `${hiText} we received your sourcing request ${q.code} (${q.product_name}, ${qty}). We reply on WhatsApp the same business day. Nothing is paid before you accept our written quote.\nFollow your request: ${account}`;
      break;
    case "quote_ready":
    case "quote_expiring": {
      const total = Number(q.quote_amount_mad || 0);
      const unit = q.quantity ? total / Number(q.quantity) : 0;
      const exp = day(q.quote_expires_at);
      const expiring = d.kind === "quote_expiring";
      subject = expiring ? `Your quote ${q.code} expires on ${exp}` : `Your quote is ready · ${q.code}`;
      title = expiring ? "Your quote expires soon" : "Your quote is ready";
      body = p(expiring
        ? `${hi} your quote for ${esc(q.product_name)} is still waiting for your answer. After ${esc(exp)} the price is no longer guaranteed.`
        : `${hi} here is your final price, delivered to your door in Morocco (product, express air shipping, customs and delivery included).`) +
        rows([["Total price", mad(total)], ["Per unit", unit ? mad(Math.ceil(unit * 100) / 100) : ""], ["Quantity", qty],
          ["40% deposit to start", pay.deposit_amount_mad ? mad(pay.deposit_amount_mad) : ""], ["Valid until", exp]]) +
        p("Open your account to accept the quote, decline it, or ask us a question. You pay the 40% deposit only after you accept.");
      button = expiring ? "Answer my quote" : "See my quote";
      text = `${hiText} ${expiring ? `your quote ${q.code} expires on ${exp}.` : `your quote ${q.code} is ready.`}\nTotal: ${mad(total)} (${qty})\nValid until: ${exp}\nAccept, decline or ask a question: ${account}`;
      break;
    }
    case "deposit_verified":
      subject = `Deposit received · ${q.code} goes into production`;
      title = "We received your 40% deposit";
      body = p(`${hi} your transfer is verified. We now order your goods from the supplier.`) +
        rows([["Deposit received", pay.deposit_amount_mad ? mad(pay.deposit_amount_mad) : ""], ["Balance (60%)", pay.balance_amount_mad ? mad(pay.balance_amount_mad) : ""]]) +
        p("Next step: before shipping, we send you photos and a video of your goods to approve. You pay the 60% balance only when your goods are in Morocco, before delivery.");
      button = "Follow my order";
      text = `${hiText} we received your 40% deposit for ${q.code}. Your order goes into production. Before shipping we send you photos and a video to approve.\nFollow your order: ${account}`;
      break;
    case "inspection_ready": {
      const n = d.inspectionFiles || 0;
      subject = `Please approve your goods before shipping · ${q.code}`;
      title = "Your goods are ready: please check them";
      body = p(`${hi} we inspected your goods${n ? ` and added ${n} photo${n > 1 ? "s" : ""} or video${n > 1 ? "s" : ""}` : ""} in your account.`) +
        p("Look at them, then click <strong>Approve shipping</strong>. If something is not right, click <strong>I have a question</strong>. We do not ship before your approval.");
      button = "Check my goods";
      text = `${hiText} the inspection photos of ${q.code} are ready. Please check them and approve shipping in your account. We do not ship before your approval.\n${account}`;
      break;
    }
    case "shipped":
      subject = `${q.code} is on its way to Morocco`;
      title = "Your goods are on the way to Morocco";
      body = p(`${hi} your goods left China by express air. We email you when they arrive in Morocco and clear customs.`) +
        rows([["Request", q.code], ["Product", q.product_name], ["Quantity", qty]]);
      button = "Track my order";
      footer = optionalFoot;
      text = `${hiText} your goods for ${q.code} left China by express air. We email you when they clear customs in Morocco.\nTrack your order: ${account}`;
      break;
    case "final_due": {
      const fee = Number(s.storage_fee_after_days || 0);
      const feeDate = fee && pay.final_due_at ? day(addDays(pay.final_due_at, fee)) : "";
      subject = `Customs cleared · please pay the 60% for ${q.code}`;
      title = "Your goods cleared customs";
      body = p(`${hi} your goods are in Morocco and cleared customs. Please pay the 60% balance so we can deliver them.`) +
        rows([["Balance to pay (60%)", pay.balance_amount_mad ? mad(pay.balance_amount_mad) : ""], ["Transfer reference", q.code]]) +
        p("Our bank details are in your account. After your transfer, upload the proof there: we check it and deliver.") +
        (feeDate ? p(`Please pay before ${esc(feeDate)}: after that date a storage fee applies (see our <a href="${SITE}/policies" style="color:#B04600">payment rules</a>).`) : "");
      button = "Pay the 60%";
      text = `${hiText} your goods for ${q.code} cleared customs in Morocco. Please pay the 60% balance${pay.balance_amount_mad ? ` (${mad(pay.balance_amount_mad)})` : ""} with ${q.code} as the reference, then upload the proof in your account.${feeDate ? ` A storage fee applies after ${feeDate}.` : ""}\n${account}`;
      break;
    }
    case "delivered": {
      const h = Number(s.claim_hours || 0);
      subject = `${q.code} is delivered · how did it go?`;
      title = "Your order is delivered";
      body = p(`${hi} your goods are delivered. Thank you for working with DDPSourcing.`) +
        (h ? p(`Please check your goods now. If something is missing or damaged, click <strong>Report a problem</strong> in your account within ${h} hours, with photos or a video.`) : "") +
        p("Happy with the result? A short review helps other sellers trust us. It takes one minute.");
      button = "Leave a review";
      link = `${SITE}/account?tab=reviews`;
      text = `${hiText} your order ${q.code} is delivered.${h ? ` If something is missing or damaged, report it in your account within ${h} hours.` : ""}\nLeave a review: ${SITE}/account?tab=reviews`;
      break;
    }
    case "refund_paid": {
      const r = d.refund || {};
      subject = `Refund sent · ${q.code}`;
      title = "We sent your refund";
      body = p(`${hi} we paid your refund by bank transfer.`) +
        rows([["Amount", r.amount_mad ? mad(r.amount_mad) : ""], ["Transfer reference", String(r.reference || "")]]) +
        p("The proof of transfer is in your account. If you do not see the money soon, reply to this email with the reference above.");
      button = "See my refund";
      text = `${hiText} we sent your refund for ${q.code}${r.amount_mad ? ` (${mad(r.amount_mad)})` : ""} by bank transfer${r.reference ? `, reference ${r.reference}` : ""}.\n${account}`;
      break;
    }
    default:
      return null;
  }
  return { subject, html: layout(label, esc(title), body, button, link, footer), text };
}
