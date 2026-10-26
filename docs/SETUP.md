# Client accounts + Team CRM: what's left for you

Already done for you:

- ✅ Supabase project **DDPSOURCING** has the full database, security rules and the private file storage.
- ✅ `assets/config.js` is connected to that project.
- ✅ New pages: `/account` (clients) and `/team` (your CRM). The estimator now sends people to `/account`.

## 1. Login settings in Supabase (3 min)

supabase.com → project **DDPSOURCING** →

**Authentication → URL Configuration**
- **Site URL**: `https://www.ddpsourcing.com`
- **Redirect URLs**: add `https://www.ddpsourcing.com/account`

**Authentication → Sign In / Providers → Email**: keep **Email** on and **Confirm email** on.

## 2. Email sender: Resend (before you advertise the site)

Supabase's built-in sender is for testing only (a few emails per hour). Resend sends the
confirmation and password emails from **no-reply@ddpsourcing.com**. Free plan: 3,000 emails/month.

**A. Resend account and domain**
1. resend.com → **Sign up** (use your business email).
2. **Domains → Add domain** → `ddpsourcing.com` → region **Ireland (eu-west-1)** (same as Supabase).
3. Resend shows DNS records (an MX and TXT records on `send.ddpsourcing.com`, and a DKIM TXT
   record `resend._domainkey`). Keep this page open.

**B. DNS records** — where your domain's DNS is managed (Vercel → Settings → Domains, or the
company where you bought the domain). Add each record exactly as Resend shows it (type, name,
value, priority for MX). Then in Resend click **Verify DNS records**. It can take from a few
minutes to a few hours.

**C. API key** — Resend → **API Keys → Create API key** → name `supabase-smtp`, permission
**Sending access**, domain `ddpsourcing.com`. Copy it. Never paste it in a chat or in the code.

**D. Connect Supabase** — Supabase → project DDPSOURCING → **Authentication → Emails → SMTP
Settings** → **Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `no-reply@ddpsourcing.com` |
| Sender name | `DDPSourcing` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the API key from step C |

Then **Authentication → Rate Limits**: set "Rate limit for sending emails" to **30 per hour**
(the default stays very low after you connect SMTP).

**E. Branded emails** — **Authentication → Emails → Templates**. For each template, set the
subject and paste the HTML file from `docs/email-templates/` (open the file on GitHub →
**Raw** → copy everything):

| Template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your DDPSourcing account | `confirm-signup.html` |
| Reset password | Reset your DDPSourcing password | `reset-password.html` |
| Change email address | Confirm your new DDPSourcing email | `change-email.html` |

**F. Test** — open the site in a private window, send a test request with a new email you own,
check the confirmation email arrives (inbox, not spam) and the link opens your account. Then
tell Claude, so the test account and request are removed.

## 3. Put the branch live

On github.com → repo **bbsourcing** → **Pull requests** → open "Client accounts + team CRM" →
check the Vercel preview link in the PR → **Merge**. Vercel publishes in about a minute.

## 4. Make yourself administrator

1. Open `https://www.ddpsourcing.com/account`, create **your** account, confirm the email.
2. Tell Claude "make me admin" (Supabase is connected), or in Supabase → **SQL Editor** run:

   ```sql
   insert into public.staff (user_id, role)
   select id, 'admin' from public.profiles where email = 'your@email.com';
   ```
3. Open `https://www.ddpsourcing.com/team` and log in.

## 5. Add your team

Each person creates an account on `/account` with their work email → in the CRM, **Team** →
enter their email, pick the role, **Add to team**.

| Role | Sees | Can do |
|---|---|---|
| Administrator | Everything | Assign, any status, quotation, payments, team |
| Sourcing Agent | Requests assigned to them | Contact notes, stages up to "Awaiting 40% deposit", quotation |
| Operations & Finance | Confirmed orders | Verify 40% / 60% payments with proof, production → delivery |
