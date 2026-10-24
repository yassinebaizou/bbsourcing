# DDPSourcing — briefing for Claude Code

DDPSourcing (ddpsourcing.com) sources products in China for Moroccan e-commerce / COD sellers and
delivers them door-to-door in Morocco by express air, for **one final DDP price**. The owner is
Yassine Baizou (Casablanca). He is a beginner with code and deployment: explain steps simply,
prefer no-terminal options when he has to act himself, and never ask him for secrets in chat.

## Stack

- Plain static HTML/CSS/JS, no build step. Hosted on **Vercel** from this repo (`main` = live).
  `vercel.json` uses `cleanUrls: true` and `trailingSlash: false` → link to `/account`, `/team`,
  `/estimate`, `/privacy` (never `.html` or a trailing slash in new links).
- **Supabase** project **DDPSOURCING**, ref `sdspalqmmbvyucfwgezx`, region eu-west-1,
  org `bbsourcing`. Auth (email + password), Postgres with row-level security, private storage
  bucket `request-files`.
- `assets/config.js` holds the Supabase URL + **publishable** key (safe to publish).
  Never commit a secret / service_role key.
- `assets/vendor/supabase.js` = supabase-js v2.118.0 UMD build (self-hosted, `window.supabase`).
- `api/estimate.js` = Vercel serverless function for the price estimator (pricing parameters
  stay server-side; do not move them to the browser).

## Files

| Path | What |
|---|---|
| `index.html` | Homepage (copy, FAQ, shipments/reviews blocks, **old Google-Sheet request form**) |
| `estimate/index.html` | Public price estimator → "Request my exact quote" opens `/account` prefilled |
| `account/index.html` | Client portal: sign up, log in, reset password, 3-step request form with images, my requests + tracking, profile |
| `team/index.html` | Internal CRM: overview KPIs, requests table + filters, request drawer (status, assignment, next action, quotation, 40/60 payments with proof upload, notes, activity), payments view, team management |
| `assets/ui.css` | Shared styles for account + team (brand tokens) |
| `supabase/migrations/` | SQL already applied to the live project. New DB changes = new migration file |
| `docs/SETUP.md` | What Yassine still has to do in dashboards |
| `privacy.html`, `terms.html` | Legal templates (bracketed parts to complete) |

## Brand

Name **DDPSourcing** (logo text "DDP" + "SOURCING"). Colors: Navy `#0B1220`, Orange `#FF6B00`
(primary CTA, dark navy text on it), Cloud `#F7F8FA`, Slate `#334155`, Green `#168A5B` (success only).
Font Archivo. Status colors always come with a text label. English copy, short sentences.
Never invent testimonials, numbers or shipment proof.

## Business rules

- Minimum order **MAD 5,000 OR 100 units**; below both = still accepted, flagged "Below min.".
- Payment **40% deposit** after the client accepts the final quotation, **60% before delivery**.
  Payments are tracked, not processed online. (The original spec named Beast Capital Group as
  invoice issuer; confirm with Yassine before showing any legal entity on the site.)
- Same-business-day WhatsApp reply, Monday–Friday 10:00–18:00 Morocco time.
- Express air only, 15–20 days.
- Estimator formula (in `api/estimate.js`): 1 USD = 10 MAD, batch of 100 units, 130 MAD/kg,
  +700 MAD approval fee for Bluetooth/WiFi products, customs 30% of (stock + transport),
  transit 700, other fees 200, margin 20%, rounded up per unit.

## Database model (Supabase, all enforced in SQL)

Tables: `profiles` (1 per auth user, created by trigger), `staff` (role `admin` | `agent` |
`ops_finance`, `active`), `requests` (code `BS-1001…`, 18 statuses in `request_statuses`),
`request_internal` (next action, team only), `payments` (1 per request, created when a quote is
saved; deposit/balance are generated columns), `request_notes`, `request_files`,
`request_events` (activity log, written only by triggers).

Who sees what:
- **Client**: only their own requests and product images. No notes, payments, events, internal fields.
- **Administrator**: everything; only role that assigns, manages staff, undoes a verified payment.
- **Sourcing Agent**: only requests assigned to them; stages up to `awaiting_deposit`; enters the quote.
- **Operations & Finance**: requests from `awaiting_deposit` onward; verifies payments; stages to `completed`.

Hard gates: `awaiting_deposit` needs a quote; `order_processing`+ needs the deposit verified;
`ready_for_delivery`+ needs the 60% verified; quote locked after deposit verified (admin excepted).
Supabase's default grants were revoked; only needed privileges are granted back. If you add a table
or function, add its RLS policy **and** explicit grants, then run the Supabase security advisor.
The 5 advisor warnings about SECURITY DEFINER functions callable by `authenticated`
(`staff_role`, `staff_can_see`, `can_see_request`, `staff_can_see_request`, `add_staff`) are intentional.

Team onboarding: the person signs up on `/account`, then an admin adds them in CRM → Team (RPC `add_staff`).
First admin: insert into `public.staff` from the SQL editor (see `docs/SETUP.md`).

## Testing

The pages were tested end to end against a local Postgres + PostgREST with Supabase stubs
(client signup from estimator → request with image → admin assigns → agent contacts and quotes
24,000 → deposit 9,600 / balance 14,400 → Ops verifies with proof → client sees "Order in production";
every forbidden action refused). For new work, test against the real project with test accounts,
or a Supabase branch; don't leave test data in production.

## To do next (in this order)

1. **Homepage request flow.** `index.html` still posts its `#request` form to a Google Apps Script
   (`CONFIG.formEndpoint`). Requests now require an account. Replace that form section with a short
   "Create your free account to send your request" block, and point every "Get my price" /
   "Request your final price" button to `/account`. The hero "paste a product link" box should go to
   `/account?link=<encoded URL>` (the account page already prefills the link from that parameter).
   Remove the now-unused Apps Script code.
2. **Privacy Policy** (`privacy.html`): mention client accounts, Supabase (EU hosting) for account,
   request and payment-tracking data, product images, and how to delete an account.
3. **Team alert on new request**: Supabase Database Webhook or Edge Function on `requests` insert →
   email (and later WhatsApp) to the team. Secrets via `create_edge_function_secret`, never in code.
4. **`vercel.json`**: add `X-Robots-Tag: noindex` for `/team` and `/account`.
5. **README.md**: rewrite for the new setup (no more Google Sheet).
6. Nice to have: export requests/payments to CSV from the CRM; client confirmation email.
