// Emails the team when a client acts on a request: quote accepted or declined, request cancelled,
// transfer proof sent (40% or 60%).
// Called by the database (trigger team_notifications_send) with { id } of a team_notifications row.
// Same safety as notify-new-request: only rows created in the last 15 minutes, each sent once
// (sent_at is claimed before sending), so calling it again does nothing.
// Secret required in Supabase → Edge Functions → Secrets: RESEND_API_KEY (already set).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://www.ddpsourcing.com";
const FROM = "DDPSourcing <no-reply@ddpsourcing.com>";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mad = (n: unknown) => (n == null ? "" : "MAD " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

const KINDS: Record<string, { title: string; ops: boolean; next: string }> = {
  quote_accepted:    { title: "Quote accepted", ops: true,  next: "The client now sees the bank details and sends the 40% transfer proof." },
  quote_declined:    { title: "Quote declined", ops: false, next: "The request is closed. Read the reason and contact the client if useful." },
  request_cancelled: { title: "Request cancelled by the client", ops: true, next: "The request is closed. If a 40% transfer was already sent, prepare the refund." },
  deposit_proof:     { title: "40% transfer proof received", ops: true, next: "Check the transfer on the bank account, then mark the 40% as verified in the CRM." },
  final_proof:       { title: "60% transfer proof received", ops: true, next: "Check the transfer on the bank account, then mark the 60% as verified in the CRM." },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let id = 0;
  try { id = Number((await req.json()).id); } catch { /* handled below */ }
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "id required" });

  // Claim the notification: a second call for the same row does nothing.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: n } = await sb.from("team_notifications").update({ sent_at: new Date().toISOString() })
    .eq("id", id).is("sent_at", null).gte("created_at", since).select("id, request_id, kind").maybeSingle();
  if (!n) return json(200, { skipped: "unknown, too old or already sent" });
  const unclaim = () => sb.from("team_notifications").update({ sent_at: null }).eq("id", id);
  const k = KINDS[n.kind];

  const { data: q } = await sb.from("requests")
    .select("id, code, product_name, quantity, quote_amount_mad, closed_reason, assigned_to, client:profiles!requests_client_id_fkey(full_name, email, whatsapp)")
    .eq("id", n.request_id).maybeSingle();
  const { data: pay } = await sb.from("payments")
    .select("deposit_amount_mad, balance_amount_mad, deposit_reference, final_reference").eq("request_id", n.request_id).maybeSingle();
  if (!q || !k) { await unclaim(); return json(404, { error: "not found" }); }

  // Recipients: the assigned person and the active administrators; Operations & Finance for payments.
  const roles = k.ops ? ["admin", "ops_finance"] : ["admin"];
  const { data: staff } = await sb.from("staff").select("role, profile:profiles!staff_user_id_fkey(email)").eq("active", true).in("role", roles);
  const to = new Set<string>(((staff || []) as any[]).map((s) => s.profile?.email).filter(Boolean));
  if (q.assigned_to) {
    const { data: p } = await sb.from("profiles").select("email").eq("id", q.assigned_to).maybeSingle();
    if (p?.email) to.add(p.email);
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!to.size || !key) { await unclaim(); return json(500, { error: !key ? "RESEND_API_KEY missing" : "no recipient" }); }

  const c: any = q.client || {};
  const amount = n.kind === "deposit_proof" ? mad(pay?.deposit_amount_mad) + (pay?.deposit_reference ? " · ref. " + pay.deposit_reference : "")
    : n.kind === "final_proof" ? mad(pay?.balance_amount_mad) + (pay?.final_reference ? " · ref. " + pay.final_reference : "")
    : mad(q.quote_amount_mad);
  const row = (label: string, v: string) =>
    v ? `<tr><td style="padding:6px 12px 6px 0;color:#64748B;font-size:13px;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;font-size:14px;color:#0B1220">${v}</td></tr>` : "";
  const html = `<div style="margin:0;padding:24px 12px;background:#F7F8FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B1220;padding:18px 24px"><span style="font-size:20px;font-weight:800;color:#fff">DDP</span><span style="font-size:10px;font-weight:700;color:#FF6B00;letter-spacing:4px;margin-left:6px">SOURCING</span></td></tr>
<tr><td style="padding:26px 24px 8px">
<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#B04600">${esc(k.title)} · ${esc(q.code)}</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0B1220">${esc(q.product_name)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0">
${row("Quantity", esc(Number(q.quantity).toLocaleString("en-US")) + " units")}
${row(n.kind.endsWith("_proof") ? "Transfer" : "Quote", esc(amount))}
${row("Reason", n.kind === "quote_declined" || n.kind === "request_cancelled" ? esc(q.closed_reason) : "")}
${row("Client", esc(c.full_name))}
${row("WhatsApp", esc(c.whatsapp))}
${row("Email", esc(c.email))}
</table>
<p style="margin:16px 0 0;font-size:14px;color:#334155">${esc(k.next)}</p>
<p style="margin:22px 0 0"><a href="${SITE}/team" style="display:inline-block;background:#FF6B00;color:#0B1220;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">Open in the CRM</a></p>
<p style="margin:18px 0 24px;font-size:12.5px;color:#64748B">Sent automatically by DDPSourcing.</p>
</td></tr></table></div>`;
  const text = `${k.title} · ${q.code}\n${q.product_name}\n${amount}\n${q.closed_reason ? "Reason: " + q.closed_reason + "\n" : ""}Client: ${c.full_name || ""} ${c.whatsapp || ""}\n${k.next}\nOpen the CRM: ${SITE}/team`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [...to], subject: `${k.title} · ${q.code} · ${q.product_name}`, html, text }),
  });
  if (!r.ok) {
    await unclaim();
    return json(502, { error: "email not sent", status: r.status, detail: (await r.text()).slice(0, 300) });
  }
  return json(200, { sent: to.size });
});
