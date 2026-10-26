// Emails the team when a new sourcing request arrives.
// Called by the database (trigger requests_notify_team) with { request_id }.
// No secret is needed from the caller: the function only announces a request created in the
// last 15 minutes, and only once (table request_notifications), so it cannot be used to spam.
// Secret required in Supabase → Edge Functions → Secrets: RESEND_API_KEY.
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
const httpLink = (u: unknown) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u ?? "")) ? String(u) : "");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let id = "";
  try { id = String((await req.json()).request_id || ""); } catch { /* handled below */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "request_id required" });

  const { data: q } = await sb.from("requests")
    .select("id, code, product_name, product_link, quantity, order_type, specifications, client_notes, delivery_city, below_minimum, created_at, assigned_to, client:profiles!requests_client_id_fkey(full_name, email, whatsapp, city, business_name)")
    .eq("id", id).maybeSingle();
  if (!q) return json(404, { error: "not found" });
  if (Date.now() - new Date(q.created_at).getTime() > 15 * 60 * 1000) return json(200, { skipped: "too old" });

  // Claim the notification: a second call for the same request does nothing.
  const claim = await sb.from("request_notifications").insert({ request_id: id });
  if (claim.error) return json(200, { skipped: "already sent" });

  // Recipient: the person the request is assigned to; otherwise every active administrator.
  let to: string[] = [];
  if (q.assigned_to) {
    const { data: p } = await sb.from("profiles").select("email").eq("id", q.assigned_to).maybeSingle();
    if (p?.email) to = [p.email];
  }
  if (!to.length) {
    const { data: admins } = await sb.from("staff").select("profile:profiles!staff_user_id_fkey(email)").eq("role", "admin").eq("active", true);
    to = (admins || []).map((a: any) => a.profile?.email).filter(Boolean);
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!to.length || !key) {
    await sb.from("request_notifications").delete().eq("request_id", id);
    return json(500, { error: !key ? "RESEND_API_KEY missing" : "no recipient" });
  }

  const c: any = q.client || {};
  const link = httpLink(q.product_link);
  const row = (k: string, v: string) =>
    v ? `<tr><td style="padding:6px 12px 6px 0;color:#64748B;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:14px;color:#0B1220">${v}</td></tr>` : "";
  const html = `<div style="margin:0;padding:24px 12px;background:#F7F8FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B1220;padding:18px 24px"><span style="font-size:20px;font-weight:800;color:#fff">DDP</span><span style="font-size:10px;font-weight:700;color:#FF6B00;letter-spacing:4px;margin-left:6px">SOURCING</span></td></tr>
<tr><td style="padding:26px 24px 8px">
<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#B04600">New sourcing request · ${esc(q.code)}</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0B1220">${esc(q.product_name)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0">
${row("Quantity", esc(Number(q.quantity).toLocaleString("en-US")) + " units" + (q.below_minimum ? " · below minimum" : ""))}
${row("Order type", q.order_type === "restock" ? "Restock" : "New product")}
${row("Product link", link ? `<a href="${esc(link)}" style="color:#B04600">${esc(link.length > 60 ? link.slice(0, 60) + "…" : link)}</a>` : "")}
${row("Specifications", esc(q.specifications))}
${row("Notes", esc(q.client_notes))}
${row("Client", esc(c.full_name) + (c.business_name ? " · " + esc(c.business_name) : ""))}
${row("WhatsApp", esc(c.whatsapp))}
${row("Email", esc(c.email))}
${row("Delivery city", esc(q.delivery_city || c.city))}
</table>
<p style="margin:22px 0 0"><a href="${SITE}/team" style="display:inline-block;background:#FF6B00;color:#0B1220;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">Open in the CRM</a></p>
<p style="margin:18px 0 24px;font-size:12.5px;color:#64748B">Reply to the client the same business day. This request is assigned to you.</p>
</td></tr></table></div>`;
  const text = `New sourcing request ${q.code}\n${q.product_name}\n${q.quantity} units\n${link}\nClient: ${c.full_name || ""} ${c.whatsapp || ""}\nOpen the CRM: ${SITE}/team`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject: `New request ${q.code} · ${q.product_name} (${q.quantity} units)`, html, text }),
  });
  if (!r.ok) {
    await sb.from("request_notifications").delete().eq("request_id", id);
    return json(502, { error: "email not sent", status: r.status, detail: (await r.text()).slice(0, 300) });
  }
  return json(200, { sent: to.length });
});
