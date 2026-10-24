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

## 2. Email sender (before you advertise the site)

Supabase's built-in email sender is only for testing and sends very few emails per hour.
**Authentication → Emails → SMTP settings**: connect a real sender (Brevo or Resend, both have a
free plan) so every client receives the confirmation and password-reset emails.

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
