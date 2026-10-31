// Administrator actions that need the service role, called from the CRM (team/index.html):
//   create_client  — creates the client account (email confirmed) and emails a secure link to choose a password
//   update_client  — edits the client's profile, including the login email
//   delete_client  — deletes the client account, their requests and their files
//   delete_request — deletes one request and its files
// The caller must be an active administrator (checked from their login token on every call).
// A request with an accepted quote or a recorded payment is never deleted: it is a business record.
// Secrets: RESEND_API_KEY (already set). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://www.ddpsourcing.com";
const FROM = "DDPSourcing <no-reply@ddpsourcing.com>";
const REPLY_TO = "contact@ddpsourcing.com";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json(status, { error });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SELLING = ["starting", "selling", "scaling"];

function normWhatsapp(v: unknown) {
  let s = String(v ?? "").replace(/[\s\-().]/g, "");
  if (/^00/.test(s)) s = "+" + s.slice(2);
  if (/^0[5-7]\d{8}$/.test(s)) s = "+212" + s.slice(1);
  return s;
}
function profileFields(b: any) {
  const store = str(b.store_link, 300);
  return {
    full_name: str(b.full_name, 120),
    whatsapp: normWhatsapp(b.whatsapp).slice(0, 30),
    city: str(b.city, 120),
    business_name: str(b.business_name, 160) || null,
    store_link: store ? (/^https?:\/\//i.test(store) ? store : "https://" + store) : null,
    selling_status: SELLING.includes(b.selling_status) ? b.selling_status : null,
  };
}

// Files of the given requests (pictures, conversation attachments, transfer proofs) in the request-files bucket.
async function requestFilePaths(ids: string[]) {
  if (!ids.length) return [] as string[];
  const [f, m, p] = await Promise.all([
    sb.from("request_files").select("path").in("request_id", ids),
    sb.from("request_messages").select("attachment_path").in("request_id", ids).not("attachment_path", "is", null),
    sb.from("payments").select("deposit_proof_path, final_proof_path").in("request_id", ids),
  ]);
  const out = new Set<string>();
  (f.data || []).forEach((x: any) => x.path && out.add(x.path));
  (m.data || []).forEach((x: any) => x.attachment_path && out.add(x.attachment_path));
  (p.data || []).forEach((x: any) => { if (x.deposit_proof_path) out.add(x.deposit_proof_path); if (x.final_proof_path) out.add(x.final_proof_path); });
  return [...out];
}
async function removeFiles(bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
}
// Refuses when a request is a business record: accepted quote, or a payment received or verified.
async function blocker(ids: string[]) {
  if (!ids.length) return null;
  const { count } = await sb.from("quote_acceptances").select("id", { count: "exact", head: true }).in("request_id", ids);
  if (count) return "has an accepted quote";
  const { data: pays } = await sb.from("payments").select("deposit_status, final_status").in("request_id", ids);
  if ((pays || []).some((p: any) => p.deposit_status !== "pending" || ["received", "verified"].includes(p.final_status))) return "has a payment recorded";
  return null;
}

function welcomeEmail(name: string, email: string, link: string) {
  const hi = name ? `Hello ${esc(name.split(" ")[0])},` : "Hello,";
  const html = `<div style="margin:0;padding:24px 12px;background:#F7F8FA;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0B1220;padding:18px 24px"><span style="font-size:20px;font-weight:800;color:#fff">DDP</span><span style="font-size:10px;font-weight:700;color:#FF6B00;letter-spacing:4px;margin-left:6px">SOURCING</span></td></tr>
<tr><td style="padding:26px 24px 8px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#0B1220">Your DDPSourcing account is ready</h1>
<p style="margin:0 0 12px;font-size:15px;color:#334155">${hi} our team created your client account. In it you follow your requests, read your quotes, pay and talk with our team.</p>
<p style="margin:0 0 4px;font-size:13px;color:#64748B">Your login email</p>
<p style="margin:0 0 18px;font-size:16px;font-weight:700;color:#0B1220">${esc(email)}</p>
<p style="margin:0"><a href="${link}" style="display:inline-block;background:#FF6B00;color:#0B1220;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:10px">Choose my password</a></p>
<p style="margin:18px 0 24px;font-size:12.5px;color:#64748B">For your security this link works once and expires soon. If it has expired, open ${SITE}/account and click "Forgot password?" with the email above. We never send passwords by email.</p>
</td></tr></table></div>`;
  const text = `${hi.replace(/&#39;/g, "'")} our team created your DDPSourcing client account.\nLogin email: ${email}\nChoose your password: ${link}\nIf the link has expired, open ${SITE}/account and click "Forgot password?".`;
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  // Caller must be an active administrator.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return fail(401, "Please log in again.");
  const { data: me } = await sb.from("staff").select("role, active").eq("user_id", who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return fail(403, "Only an administrator can do this.");

  let b: any = {};
  try { b = await req.json(); } catch { return fail(400, "Invalid request."); }
  const isStaff = async (id: string) => !!(await sb.from("staff").select("user_id").eq("user_id", id).maybeSingle()).data;

  if (b.action === "create_client") {
    const email = str(b.email, 200).toLowerCase();
    if (!EMAIL.test(email)) return fail(400, "Enter a valid email address.");
    const fields = profileFields(b);
    if (!fields.full_name) return fail(400, "Enter the client's full name.");
    const created = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { ...fields } });
    if (created.error || !created.data.user) {
      const m = created.error?.message || "";
      return fail(/already|registered|exists/i.test(m) ? 409 : 400, /already|registered|exists/i.test(m) ? "An account already exists with this email." : m || "Could not create the account.");
    }
    const id = created.data.user.id;
    await sb.from("profiles").update({ ...fields, email }).eq("id", id);
    const link = await sb.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${SITE}/account` } });
    const key = Deno.env.get("RESEND_API_KEY");
    let emailed = false;
    if (!link.error && link.data?.properties?.action_link && key) {
      const { html, text } = welcomeEmail(fields.full_name, email, link.data.properties.action_link);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email], reply_to: REPLY_TO, subject: "Your DDPSourcing account is ready", html, text }),
      });
      emailed = r.ok;
    }
    return json(200, { id, emailed });
  }

  if (b.action === "update_client") {
    const id = str(b.id, 64);
    if (!id || await isStaff(id)) return fail(400, "This is not a client account.");
    const fields = profileFields(b);
    if (!fields.full_name) return fail(400, "Enter the client's full name.");
    const { data: cur } = await sb.from("profiles").select("email").eq("id", id).maybeSingle();
    if (!cur) return fail(404, "Client not found.");
    const email = str(b.email, 200).toLowerCase();
    if (email && email !== String(cur.email || "").toLowerCase()) {
      if (!EMAIL.test(email)) return fail(400, "Enter a valid email address.");
      const u = await sb.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (u.error) return fail(400, /already|registered|exists/i.test(u.error.message) ? "Another account already uses this email." : u.error.message);
      (fields as any).email = email;
    }
    const up = await sb.from("profiles").update(fields).eq("id", id);
    if (up.error) return fail(400, up.error.message);
    return json(200, { ok: true });
  }

  if (b.action === "delete_client") {
    const id = str(b.id, 64);
    if (!id || await isStaff(id)) return fail(400, "Team members cannot be deleted here. Remove them in Team first.");
    const { data: reqs } = await sb.from("requests").select("id").eq("client_id", id);
    const ids = (reqs || []).map((r: any) => r.id);
    const why = await blocker(ids);
    if (why) return fail(409, `This client cannot be deleted: one of their requests ${why}. Keep the client, or edit their details instead.`);
    const files = await requestFilePaths(ids);
    const { data: revs } = await sb.from("reviews").select("media_path").eq("client_id", id).not("media_path", "is", null);
    const del = await sb.auth.admin.deleteUser(id);
    if (del.error) return fail(400, del.error.message);
    await removeFiles("request-files", files);
    await removeFiles("review-media", (revs || []).map((r: any) => r.media_path));
    return json(200, { ok: true, requests: ids.length });
  }

  if (b.action === "delete_request") {
    const id = str(b.id, 64);
    const { data: q } = await sb.from("requests").select("id, code").eq("id", id).maybeSingle();
    if (!q) return fail(404, "Request not found.");
    const why = await blocker([id]);
    if (why) return fail(409, `${q.code} cannot be deleted: it ${why}. Close it as "Not qualified" instead.`);
    const files = await requestFilePaths([id]);
    const del = await sb.from("requests").delete().eq("id", id);
    if (del.error) return fail(400, del.error.message);
    await removeFiles("request-files", files);
    return json(200, { ok: true, code: q.code });
  }

  return fail(400, "Unknown action.");
});
