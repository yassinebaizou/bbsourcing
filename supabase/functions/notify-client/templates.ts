// Branded client emails, in English or French (profiles.language; Arabic comes in Sprint 8).
// Pure functions: no database, no network, so tests/emails.mjs can render every email locally.

export const SITE = "https://www.ddpsourcing.com";
export const OPTIONAL = ["request_received", "shipped"];  // the client can turn these off in their profile

export type EmailData = {
  kind: string;
  lang?: string;  // "fr" = French, anything else = English
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
const madFr = (n: unknown) =>
  Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/\u202f|\u00a0/g, " ") + " MAD";
const day = (iso?: string | null, lang = "en") =>
  iso ? new Date(iso).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Casablanca" }) : "";
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
  if (d.lang === "fr") return buildEmailFr(d);
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

// ---------- French ----------
function buildEmailFr(d: EmailData): { subject: string; html: string; text: string } | null {
  const q = d.request, pay = d.payment || {}, s = d.settings || {};
  const first = String(d.client.full_name || "").trim().split(" ")[0];
  const hiText = first ? `Bonjour ${first},` : "Bonjour,";
  const hi = esc(hiText);
  const label = `Votre demande ${esc(q.code)} · ${esc(q.product_name)}`;
  const account = `${SITE}/fr/account`;
  const optionalFoot = `Vous recevez cet e-mail à chaque étape de votre commande. Vous pouvez désactiver ces e-mails d’étape dans <a href="${account}?tab=profile" style="color:#B04600">votre profil</a>.`;
  const foot = "Une question ? Répondez dans votre compte client, ou répondez à cet e-mail.";
  const qty = q.quantity ? Number(q.quantity).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ") + " unités" : "";
  const fday = (iso?: string | null) => day(iso, "fr");
  let subject = "", title = "", body = "", button = "Ouvrir mon compte", link = account, footer = foot, text = "";

  switch (d.kind) {
    case "request_received":
      subject = `Nous avons reçu votre demande ${q.code}`;
      title = "Nous avons reçu votre demande de sourcing";
      body = p(`${hi} merci. Notre équipe étudie votre demande et vous répond sur WhatsApp le jour ouvré même (du lundi au vendredi, de 10 h à 18 h).`) +
        rows([["Demande", q.code], ["Produit", q.product_name], ["Quantité", qty]]) +
        p("Prochaine étape : nous vérifions le produit avec nos fournisseurs, puis nous vous envoyons un devis écrit avec un seul prix final, livré à votre porte. Rien n’est payé avant votre accord.");
      button = "Suivre ma demande";
      footer = optionalFoot;
      text = `${hiText} nous avons reçu votre demande de sourcing ${q.code} (${q.product_name}, ${qty}). Nous répondons sur WhatsApp le jour ouvré même. Rien n’est payé avant votre accord sur notre devis écrit.\nSuivre votre demande : ${account}`;
      break;
    case "quote_ready":
    case "quote_expiring": {
      const total = Number(q.quote_amount_mad || 0);
      const unit = q.quantity ? total / Number(q.quantity) : 0;
      const exp = fday(q.quote_expires_at);
      const expiring = d.kind === "quote_expiring";
      subject = expiring ? `Votre devis ${q.code} expire le ${exp}` : `Votre devis est prêt · ${q.code}`;
      title = expiring ? "Votre devis expire bientôt" : "Votre devis est prêt";
      body = p(expiring
        ? `${hi} votre devis pour ${esc(q.product_name)} attend toujours votre réponse. Après le ${esc(exp)}, le prix n’est plus garanti.`
        : `${hi} voici votre prix final, livré à votre porte au Maroc (produit, fret aérien express, douane et livraison compris).`) +
        rows([["Prix total", madFr(total)], ["Par unité", unit ? madFr(Math.ceil(unit * 100) / 100) : ""], ["Quantité", qty],
          ["Acompte de 40 % pour démarrer", pay.deposit_amount_mad ? madFr(pay.deposit_amount_mad) : ""], ["Valable jusqu’au", exp]]) +
        p("Ouvrez votre compte pour accepter le devis, le refuser ou nous poser une question. Vous payez l’acompte de 40 % seulement après votre accord.");
      button = expiring ? "Répondre à mon devis" : "Voir mon devis";
      text = `${hiText} ${expiring ? `votre devis ${q.code} expire le ${exp}.` : `votre devis ${q.code} est prêt.`}\nTotal : ${madFr(total)} (${qty})\nValable jusqu’au : ${exp}\nAccepter, refuser ou poser une question : ${account}`;
      break;
    }
    case "deposit_verified":
      subject = `Acompte reçu · ${q.code} part en production`;
      title = "Nous avons reçu votre acompte de 40 %";
      body = p(`${hi} votre virement est vérifié. Nous commandons maintenant vos marchandises au fournisseur.`) +
        rows([["Acompte reçu", pay.deposit_amount_mad ? madFr(pay.deposit_amount_mad) : ""], ["Solde (60 %)", pay.balance_amount_mad ? madFr(pay.balance_amount_mad) : ""]]) +
        p("Prochaine étape : avant l’expédition, nous vous envoyons des photos et une vidéo de vos marchandises à valider. Vous payez le solde de 60 % seulement quand vos marchandises sont au Maroc, avant la livraison.");
      button = "Suivre ma commande";
      text = `${hiText} nous avons reçu votre acompte de 40 % pour ${q.code}. Votre commande part en production. Avant l’expédition, nous vous envoyons des photos et une vidéo à valider.\nSuivre votre commande : ${account}`;
      break;
    case "inspection_ready": {
      const n = d.inspectionFiles || 0;
      subject = `Merci de valider vos marchandises avant l’expédition · ${q.code}`;
      title = "Vos marchandises sont prêtes : vérifiez-les";
      body = p(`${hi} nous avons contrôlé vos marchandises${n ? ` et ajouté ${n} photo${n > 1 ? "s" : ""} ou vidéo${n > 1 ? "s" : ""}` : ""} dans votre compte.`) +
        p("Regardez-les, puis cliquez sur <strong>Valider l’expédition</strong>. Si quelque chose ne va pas, cliquez sur <strong>J’ai une question</strong>. Nous n’expédions rien sans votre accord.");
      button = "Vérifier mes marchandises";
      text = `${hiText} les photos du contrôle de ${q.code} sont prêtes. Vérifiez-les et validez l’expédition dans votre compte. Nous n’expédions rien sans votre accord.\n${account}`;
      break;
    }
    case "shipped":
      subject = `${q.code} est en route vers le Maroc`;
      title = "Vos marchandises sont en route vers le Maroc";
      body = p(`${hi} vos marchandises ont quitté la Chine par avion express. Nous vous écrivons dès leur arrivée au Maroc et leur dédouanement.`) +
        rows([["Demande", q.code], ["Produit", q.product_name], ["Quantité", qty]]);
      button = "Suivre ma commande";
      footer = optionalFoot;
      text = `${hiText} vos marchandises pour ${q.code} ont quitté la Chine par avion express. Nous vous écrivons dès leur dédouanement au Maroc.\nSuivre votre commande : ${account}`;
      break;
    case "final_due": {
      const fee = Number(s.storage_fee_after_days || 0);
      const feeDate = fee && pay.final_due_at ? fday(addDays(pay.final_due_at, fee)) : "";
      subject = `Douane passée · merci de payer les 60 % de ${q.code}`;
      title = "Vos marchandises sont dédouanées";
      body = p(`${hi} vos marchandises sont au Maroc et dédouanées. Merci de payer le solde de 60 % pour que nous puissions les livrer.`) +
        rows([["Solde à payer (60 %)", pay.balance_amount_mad ? madFr(pay.balance_amount_mad) : ""], ["Référence du virement", q.code]]) +
        p("Nos coordonnées bancaires sont dans votre compte. Après votre virement, envoyez-y la preuve : nous la vérifions et nous livrons.") +
        (feeDate ? p(`Merci de payer avant le ${esc(feeDate)} : après cette date, des frais de stockage s’appliquent (voir nos <a href="${SITE}/fr/policies" style="color:#B04600">règles de paiement</a>).`) : "");
      button = "Payer les 60 %";
      text = `${hiText} vos marchandises pour ${q.code} sont dédouanées au Maroc. Merci de payer le solde de 60 %${pay.balance_amount_mad ? ` (${madFr(pay.balance_amount_mad)})` : ""} avec ${q.code} comme référence, puis d’envoyer la preuve dans votre compte.${feeDate ? ` Des frais de stockage s’appliquent après le ${feeDate}.` : ""}\n${account}`;
      break;
    }
    case "delivered": {
      const h = Number(s.claim_hours || 0);
      subject = `${q.code} est livrée · comment ça s’est passé ?`;
      title = "Votre commande est livrée";
      body = p(`${hi} vos marchandises sont livrées. Merci de votre confiance.`) +
        (h ? p(`Vérifiez vos marchandises maintenant. S’il manque des unités ou si certaines sont abîmées, cliquez sur <strong>Signaler un problème</strong> dans votre compte dans les ${h} heures, avec des photos ou une vidéo.`) : "") +
        p("Satisfait du résultat ? Un court avis aide les autres vendeurs à nous faire confiance. Cela prend une minute.");
      button = "Laisser un avis";
      link = `${account}?tab=reviews`;
      text = `${hiText} votre commande ${q.code} est livrée.${h ? ` S’il manque des unités ou si certaines sont abîmées, signalez-le dans votre compte dans les ${h} heures.` : ""}\nLaisser un avis : ${account}?tab=reviews`;
      break;
    }
    case "refund_paid": {
      const r = d.refund || {};
      subject = `Remboursement envoyé · ${q.code}`;
      title = "Nous avons envoyé votre remboursement";
      body = p(`${hi} nous avons payé votre remboursement par virement bancaire.`) +
        rows([["Montant", r.amount_mad ? madFr(r.amount_mad) : ""], ["Référence du virement", String(r.reference || "")]]) +
        p("La preuve du virement est dans votre compte. Si vous ne voyez pas l’argent bientôt, répondez à cet e-mail avec la référence ci-dessus.");
      button = "Voir mon remboursement";
      text = `${hiText} nous avons envoyé votre remboursement pour ${q.code}${r.amount_mad ? ` (${madFr(r.amount_mad)})` : ""} par virement${r.reference ? `, référence ${r.reference}` : ""}.\n${account}`;
      break;
    }
    default:
      return null;
  }
  return { subject, html: layout(label, esc(title), body, button, link, footer), text };
}
