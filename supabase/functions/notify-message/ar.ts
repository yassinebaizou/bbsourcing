// Arabic versions of the automatic texts the database writes in the conversation (stage names and
// system messages), for clients who chose Arabic. The client account shows the same translations
// from assets/i18n/ar.json; tests/emails.mjs checks that both agree.

export const STAGES_AR: Record<string, string> = {
  "In review": "قيد الدراسة",
  "Approved": "مقبول",
  "Approved, preparing your quotation": "مقبول، جارٍ إعداد عرض السعر",
  "Quotation sent": "تم إرسال عرض السعر",
  "Waiting for 40% deposit": "في انتظار الدفعة الأولى 40%",
  "In production": "قيد الإنتاج",
  "Quality inspection": "فحص الجودة",
  "Shipped to Morocco": "تم الشحن إلى المغرب",
  "Arrived in Morocco, in customs clearance": "وصل إلى المغرب، قيد التخليص الجمركي",
  "Customs cleared": "تم التخليص الجمركي",
  "Waiting for 60% payment": "في انتظار دفع 60%",
  "Out for delivery": "قيد التوصيل",
  "Delivered": "تم التسليم",
  "Refund in progress": "الاسترداد جارٍ",
  "Refunded": "تم الاسترداد",
  "Cancelled": "ملغى",
  "Cancelled by DDPSourcing": "ألغته DDPSourcing",
  "Closed": "مغلق",
};

const MONTHS: Record<string, string> = {
  Jan: "يناير", Feb: "فبراير", Mar: "مارس", Apr: "أبريل", May: "ماي", Jun: "يونيو",
  Jul: "يوليوز", Aug: "غشت", Sep: "شتنبر", Oct: "أكتوبر", Nov: "نونبر", Dec: "دجنبر",
};
const date = (s: string) => s.replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (_, d, m, y) => `${d} ${MONTHS[m]} ${y}`);
const mad = (s: string) => s.replace(/MAD ([\d,]+(?:\.\d+)?)/g, (_, n) => Number(n.replace(/,/g, "")).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " درهم");

const CLAIM: Record<string, string> = {
  "credit on your next order": "رصيد على طلبيتك القادمة",
  "replacement of the affected units": "استبدال القطع المعنية",
  "claim not accepted": "المطالبة غير مقبولة",
};

// Returns the Arabic text, or the original text when it is not an automatic message we know.
export function arBody(body: string): string {
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^Status update: (.+)$/))) return "تحديث الحالة: " + (STAGES_AR[m[1]] || m[1]);
  if ((m = body.match(/^Reminder: your 60% payment of (MAD [\d,.]+) is due\. Use the bank details in your account and write (\S+) as the reference\.( A storage fee applies from (.+?)\.)? Without payment by (.+?), the order is cancelled and the deposit is kept \(see our payment rules\)\.$/)))
    return mad(`تذكير: حان موعد دفع 60% بقيمة ${m[1]}. استعمل المعلومات البنكية في حسابك واكتب ${m[2]} كمرجع.`) +
      (m[4] ? ` تُطبق رسوم التخزين ابتداءً من ${date(m[4])}.` : "") +
      ` بدون دفع قبل ${date(m[5])}، تُلغى الطلبية وتُحتفظ الدفعة الأولى (انظر قواعد الدفع).`;
  if ((m = body.match(/^Refund paid: (MAD [\d,.]+) by bank transfer \(reference (.+)\)\.$/)))
    return mad(`تم دفع الاسترداد: ${m[1]} بتحويل بنكي (المرجع ${m[2]}).`);
  if ((m = body.match(/^Claim answered: refund of (MAD [\d,.]+)\.(.*)$/s)))
    return mad(`تم الرد على المطالبة: استرداد ${m[1]}.`) + m[2];
  if ((m = body.match(/^Claim answered: (credit on your next order|replacement of the affected units|claim not accepted)\.(.*)$/s)))
    return `تم الرد على المطالبة: ${CLAIM[m[1]]}.` + m[2];
  if (body === "Claim update: our team is reviewing your claim.") return "تحديث المطالبة: يدرس فريقنا مطالبتك.";
  if ((m = body.match(/^We cancelled this order: (.*?)( You receive a full refund of (MAD [\d,.]+) by bank transfer\.)?$/s)))
    return `ألغينا هذه الطلبية: ${m[1]}` + (m[3] ? mad(` تسترد المبلغ كاملًا ${m[3]} بتحويل بنكي.`) : "");
  if ((m = body.match(/^Inspection photos are ready \((\d+) files?\)\. Please look at them in your account and approve shipping, or ask us a question\.$/)))
    return `صور الفحص جاهزة (${m[1]} ${Number(m[1]) > 1 ? "ملفات" : "ملف"}). اطلع عليها في حسابك ووافق على الشحن، أو اطرح علينا سؤالًا.`;
  return body;
}
