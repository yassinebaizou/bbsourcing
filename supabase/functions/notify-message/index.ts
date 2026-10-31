// Emails the conversation in both directions.
//   client_message -> the assigned team member (every active administrator if unassigned)
//   team_message   -> the client
//   status_update  -> the client (new stage of their request)
// Called by the database (trigger message_notifications_send) with { id } of a message_notifications row.
// Same safety as notify-team: only rows created in the last 15 minutes, each sent once
// (sent_at is claimed before sending). Grouping (max one message email per 10 minutes) is done in SQL.
// Secret required in Supabase → Edge Functions → Secrets: RESEND_API_KEY (already set).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://www.ddpsourcing.com";
const FROM = "DDPSourcing <no-reply@ddpsourcing.com>";
const REPLY_TO = "contact@ddpsourcing.com";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function layout(label: string, title: string, body: string, button: string, link: string, foot: string) {
  return `<div style="margin:0;padding:24px 12px;background:#F7F8FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B1220;padding:18px 24px"><span style="font-size:20px;font-weight:800;color:#fff">DDP</span><span style="font-size:10px;font-weight:700;color:#FF6B00;letter-spacing:4px;margin-left:6px">SOURCING</span></td></tr>
<tr><td style="padding:26px 24px 8px">
<p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#B04600">${label}</p>
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0B1220">${title}</h1>
${body}
<p style="margin:22px 0 0"><a href="${link}" style="display:inline-block;background:#FF6B00;color:#0B1220;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">${button}</a></p>
<p style="margin:18px 0 24px;font-size:12.5px;color:#64748B">${foot}</p>
</td></tr></table></div>`;
}
const quote = (text: string) =>
  `<div style="margin:0;padding:14px 16px;background:#F7F8FA;border-left:4px solid #FF6B00;border-radius:8px;font-size:15px;line-height:1.5;color:#0B1220;white-space:pre-wrap">${esc(cut(text, 1500))}</div>`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let id = 0;
  try { id = Number((await req.json()).id); } catch { /* handled below */ }
  if (!Number.isInteger(id) || id <= 0) return json(400, { error: "id required" });

  // Claim the notification: a second call for the same row does nothing.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: n } = await sb.from("message_notifications").update({ sent_at: new Date().toISOString() })
    .eq("id", id).is("sent_at", null).gte("created_at", since).select("id, request_id, message_id, kind").maybeSingle();
  if (!n) return json(200, { skipped: "unknown, too old or already sent" });
  const unclaim = () => sb.from("message_notifications").update({ sent_at: null }).eq("id", id);

  const [{ data: m }, { data: q }] = await Promise.all([
    sb.from("request_messages").select("body, attachment_name").eq("id", n.message_id).maybeSingle(),
    sb.from("requests").select("code, product_name, assigned_to, client:profiles!requests_client_id_fkey(full_name, email, whatsapp)").eq("id", n.request_id).maybeSingle(),
  ]);
  if (!m || !q) { await unclaim(); return json(404, { error: "not found" }); }
  const c: any = q.client || {};
  const att = m.attachment_name ? `<p style="margin:10px 0 0;font-size:14px;color:#334155">📎 File attached: ${esc(m.attachment_name)}</p>` : "";

  let to: string[] = [], subject = "", html = "", text = "";
  if (n.kind === "client_message") {
    if (q.assigned_to) {
      const { data: p } = await sb.from("profiles").select("email").eq("id", q.assigned_to).maybeSingle();
      if (p?.email) to = [p.email];
    }
    if (!to.length) {
      const { data: admins } = await sb.from("staff").select("profile:profiles!staff_user_id_fkey(email)").eq("role", "admin").eq("active", true);
      to = ((admins || []) as any[]).map((a) => a.profile?.email).filter(Boolean);
    }
    subject = `New message from ${c.full_name || "a client"} · ${q.code}`;
    html = layout(`Message from the client · ${esc(q.code)}`, esc(q.product_name),
      `<p style="margin:0 0 10px;font-size:14px;color:#334155"><strong>${esc(c.full_name)}</strong>${c.whatsapp ? " · " + esc(c.whatsapp) : ""}</p>${quote(m.body)}${att}`,
      "Reply in the CRM", `${SITE}/team`, "Reply the same business day. Other messages sent in the next 10 minutes are grouped in the CRM.");
    text = `New message from ${c.full_name || "the client"} on ${q.code} (${q.product_name}):\n\n${m.body}\n\nReply in the CRM: ${SITE}/team`;
  } else {
    if (c.email) to = [c.email];
    const hiText = c.full_name ? `Hello ${String(c.full_name).split(" ")[0]},` : "Hello,";
    const hi = esc(hiText);
    if (n.kind === "team_message") {
      subject = `New message from DDPSourcing · ${q.code}`;
      html = layout(`Your request ${esc(q.code)}`, esc(q.product_name),
        `<p style="margin:0 0 10px;font-size:15px;color:#334155">${hi} our team sent you a message:</p>${quote(m.body)}${att}`,
        "Read and reply", `${SITE}/account`, "Please reply in your client account so the whole conversation stays in one place.");
      text = `${hiText} our team sent you a message about ${q.code} (${q.product_name}):\n\n${m.body}\n\nRead and reply: ${SITE}/account`;
    } else {
      const stage = String(m.body).replace(/^Status update:\s*/i, "");
      subject = `${q.code}: ${stage}`;
      html = layout(`Your request ${esc(q.code)}`, esc(q.product_name),
        `<p style="margin:0 0 10px;font-size:15px;color:#334155">${hi} your request has a new status:</p><p style="margin:0;font-size:20px;font-weight:800;color:#0B1220">${esc(stage)}</p>`,
        "See the details", `${SITE}/account`, "You receive this email for each step of your order.");
      text = `${hiText} your request ${q.code} (${q.product_name}) has a new status: ${stage}\n\nSee the details: ${SITE}/account`;
    }
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!to.length || !key) { await unclaim(); return json(500, { error: !key ? "RESEND_API_KEY missing" : "no recipient" }); }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, reply_to: n.kind === "client_message" ? undefined : REPLY_TO, subject, html, text }),
  });
  if (!r.ok) {
    await unclaim();
    return json(502, { error: "email not sent", status: r.status, detail: (await r.text()).slice(0, 300) });
  }
  return json(200, { sent: to.length });
});
