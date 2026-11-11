// Emails the client at the key moments of their order (Sprint 6). Templates: ./templates.ts.
// Called by the database (trigger client_emails_send) with { id } of a client_emails row.
// Same safety as notify-message: only rows created in the last 15 minutes, each sent once
// (sent_at is claimed before sending), so calling it from outside cannot spam anyone.
// Optional emails (request received, shipped) are skipped when the client turned them off.
// Secret required in Supabase → Edge Functions → Secrets: RESEND_API_KEY (already set).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildEmail, OPTIONAL } from "./templates.ts";

const FROM = "DDPSourcing <no-reply@ddpsourcing.com>";
const REPLY_TO = "contact@ddpsourcing.com";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let id = 0;
  try { id = Number((await req.json()).id); } catch { /* handled below */ }
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "id required" });

  // Claim the email: a second call for the same row does nothing.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: e } = await sb.from("client_emails").update({ sent_at: new Date().toISOString() })
    .eq("id", id).is("sent_at", null).gte("created_at", since).select("id, request_id, kind, ref").maybeSingle();
  if (!e) return json(200, { skipped: "unknown, too old or already sent" });
  const unclaim = () => sb.from("client_emails").update({ sent_at: null }).eq("id", id);

  const [{ data: q }, { data: pay }, { data: s }] = await Promise.all([
    sb.from("requests").select("code, product_name, quantity, quote_amount_mad, quote_expires_at, client:profiles!requests_client_id_fkey(full_name, email, email_updates, language)")
      .eq("id", e.request_id).maybeSingle(),
    sb.from("payments").select("deposit_amount_mad, balance_amount_mad, final_due_at").eq("request_id", e.request_id).maybeSingle(),
    sb.from("business_settings").select("claim_hours, storage_fee_after_days").eq("id", true).maybeSingle(),
  ]);
  if (!q) { await unclaim(); return json(404, { error: "request not found" }); }
  const c: any = q.client || {};
  if (OPTIONAL.includes(e.kind) && c.email_updates === false) {
    await sb.from("client_emails").update({ skipped: "client turned off step-by-step emails" }).eq("id", id);
    return json(200, { skipped: "client turned off optional emails" });
  }
  let refund = null, inspectionFiles = 0;
  if (e.kind === "refund_paid" && e.ref) refund = (await sb.from("refunds").select("amount_mad, reference").eq("id", e.ref).maybeSingle()).data;
  if (e.kind === "inspection_ready") {
    const { count } = await sb.from("inspection_media").select("id", { count: "exact", head: true }).eq("request_id", e.request_id);
    inspectionFiles = count || 0;
  }

  const mail = buildEmail({ kind: e.kind, lang: c.language, client: c, request: q as any, payment: pay, refund, settings: s, inspectionFiles });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!mail || !c.email || !key) {
    await unclaim();
    return json(500, { error: !key ? "RESEND_API_KEY missing" : !c.email ? "no recipient" : "unknown kind" });
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [c.email], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!r.ok) {
    await unclaim();
    return json(502, { error: "email not sent", status: r.status, detail: (await r.text()).slice(0, 300) });
  }
  return json(200, { sent: 1 });
});
