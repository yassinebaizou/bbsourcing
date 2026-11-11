// French versions of the automatic texts the database writes in the conversation (stage names and
// system messages), for clients who chose French. The client account shows the same translations
// from assets/i18n/fr.json; tests/emails.mjs checks that both agree.

export const STAGES_FR: Record<string, string> = {
  "In review": "En cours d’étude",
  "Approved": "Approuvée",
  "Approved, preparing your quotation": "Approuvée, devis en préparation",
  "Quotation sent": "Devis envoyé",
  "Waiting for 40% deposit": "En attente de l’acompte de 40 %",
  "In production": "En production",
  "Quality inspection": "Contrôle qualité",
  "Shipped to Morocco": "Expédiée vers le Maroc",
  "Arrived in Morocco, in customs clearance": "Arrivée au Maroc, en dédouanement",
  "Customs cleared": "Dédouanée",
  "Waiting for 60% payment": "En attente du paiement de 60 %",
  "Out for delivery": "En cours de livraison",
  "Delivered": "Livrée",
  "Refund in progress": "Remboursement en cours",
  "Refunded": "Remboursée",
  "Cancelled": "Annulée",
  "Cancelled by DDPSourcing": "Annulée par DDPSourcing",
  "Closed": "Clôturée",
};

const MONTHS: Record<string, string> = {
  Jan: "janv.", Feb: "févr.", Mar: "mars", Apr: "avr.", May: "mai", Jun: "juin",
  Jul: "juil.", Aug: "août", Sep: "sept.", Oct: "oct.", Nov: "nov.", Dec: "déc.",
};
const date = (s: string) => s.replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (_, d, m, y) => `${d} ${MONTHS[m]} ${y}`);
const mad = (s: string) => s.replace(/MAD ([\d,]+(?:\.\d+)?)/g, (_, n) => Number(n.replace(/,/g, "")).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/ | /g, " ") + " MAD");

const CLAIM: Record<string, string> = {
  "credit on your next order": "avoir sur votre prochaine commande",
  "replacement of the affected units": "remplacement des unités concernées",
  "claim not accepted": "réclamation non acceptée",
};

// Returns the French text, or the original text when it is not an automatic message we know.
export function frBody(body: string): string {
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^Status update: (.+)$/))) return "Mise à jour : " + (STAGES_FR[m[1]] || m[1]);
  if ((m = body.match(/^Reminder: your 60% payment of (MAD [\d,.]+) is due\. Use the bank details in your account and write (\S+) as the reference\.( A storage fee applies from (.+?)\.)? Without payment by (.+?), the order is cancelled and the deposit is kept \(see our payment rules\)\.$/)))
    return mad(`Rappel : votre paiement de 60 % de ${m[1]} est dû. Utilisez les coordonnées bancaires de votre compte et indiquez ${m[2]} comme référence.`) +
      (m[4] ? ` Des frais de stockage s’appliquent à partir du ${date(m[4])}.` : "") +
      ` Sans paiement avant le ${date(m[5])}, la commande est annulée et l’acompte est conservé (voir nos règles de paiement).`;
  if ((m = body.match(/^Refund paid: (MAD [\d,.]+) by bank transfer \(reference (.+)\)\.$/)))
    return mad(`Remboursement payé : ${m[1]} par virement (référence ${m[2]}).`);
  if ((m = body.match(/^Claim answered: refund of (MAD [\d,.]+)\.(.*)$/s)))
    return mad(`Réclamation traitée : remboursement de ${m[1]}.`) + m[2];
  if ((m = body.match(/^Claim answered: (credit on your next order|replacement of the affected units|claim not accepted)\.(.*)$/s)))
    return `Réclamation traitée : ${CLAIM[m[1]]}.` + m[2];
  if (body === "Claim update: our team is reviewing your claim.") return "Réclamation : notre équipe étudie votre réclamation.";
  if ((m = body.match(/^We cancelled this order: (.*?)( You receive a full refund of (MAD [\d,.]+) by bank transfer\.)?$/s)))
    return `Nous avons annulé cette commande : ${m[1]}` + (m[3] ? mad(` Vous recevez un remboursement complet de ${m[3]} par virement.`) : "");
  if ((m = body.match(/^Inspection photos are ready \((\d+) files?\)\. Please look at them in your account and approve shipping, or ask us a question\.$/)))
    return `Les photos du contrôle sont prêtes (${m[1]} fichier${Number(m[1]) > 1 ? "s" : ""}). Regardez-les dans votre compte et validez l’expédition, ou posez-nous une question.`;
  return body;
}
