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
- **Speed / security headers** (`vercel.json`): Content-Security-Policy allows only this site, Google Fonts and the
  Supabase project. **If you add any external script, image, font or API, add its host to the CSP or it is blocked.**
  Static files are cached (vendor 7 days, proof photos 30 days, ui.css/config.js 1 hour). The homepage loads
  `supabase.js` lazily (`loadSupabase()`): after the page is shown or on the first focus in the request form.
  Proof photos are WebP (`assets/proof/*.webp`, originals kept as .jpg), lazy-loaded with width/height set.
- `api/estimate.js` = Vercel serverless function for the price estimator (pricing parameters
  stay server-side; do not move them to the browser).

## Files

| Path | What |
|---|---|
| `index.html` | Homepage (copy, FAQ, shipments/reviews blocks). Header: **Get estimated price** (→ `/estimate`, instant indicative price, nothing sent to the team) and **Submit sourcing request** (→ `#request`, the real request). Use these two names everywhere, including the client account. `#request` is the 3-step request form: product (link, name, order type, quantity, pictures, specs) → contact (name, WhatsApp, city, selling status; no budget or arrival date) → email, checked with `account_exists`: existing account = password + log in, request inserted under it; new = choose a password, account created at submit and the request travels in `pending_request` (same as `/account`); logged-in visitors insert directly. Supabase is loaded on the homepage for this |
| `estimate/index.html` | Public price estimator → "Request my exact quote" opens `/account` prefilled |
| `account/index.html` | Client portal. Request form = same simple fields as the homepage (step 1 product: link, name, order type, quantity, pictures, specs; step 2: delivery city, notes, consents; step 3 for visitors without a session: email checked with `account_exists` → log in, or name/WhatsApp/selling status + new password; the request travels in `pending_request`). Category/USD price/weight are hidden fields filled only from the estimator. **Get estimated price** is a tab inside the account (same `/api/estimate`), with a button that turns the tested product into a prefilled request. Also: log in, reset password (a reset link always opens the new-password form), my requests + tracking + unread badges, two-way conversation per request, profile |
| `team/index.html` | Internal CRM: dashboard (period KPIs, needs-attention list, 12-month sales/profit chart, pipeline, team performance), requests table/board + filters, clients view (totals, profit), payments, team management; request drawer with client conversation, status, assignment, next action, quotation, 40/60 payments with proof, costs & profit, notes, activity |
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
`ops_finance`, `active`), `requests` (code `DDP-1001…`; older `BS-` codes were renamed, 18 statuses in `request_statuses`),
`request_internal` (next action, team only), `payments` (1 per request, created when a quote is
saved; deposit/balance are generated columns), `request_notes`, `request_files`,
`request_events` (activity log, written only by triggers), `request_messages` (client ↔ team
conversation; `kind='update'` rows are written by the status trigger when the client stage changes),
`message_reads` (per-user last read), `order_costs` (admin + ops_finance only; profit = final price − total cost),
`reviews` (client review: headline, text, one photo/video in the private `review-media` bucket, public name, consent;
always `pending` on insert, only staff change `status` to approved/rejected; the homepage reads `published_reviews()` and
signed URLs, allowed for anon only on approved media). Clients never see a review's status (account → Leave a review shows
only a thank-you); the team publishes in CRM → Reviews.

Who sees what:
- **Client**: only their own requests, product images and conversation (team messages show as "DDPSourcing team"). No notes, payments, costs, events, internal fields.
- **Administrator**: everything; only role that assigns, manages staff, undoes a verified payment.
- **Sourcing Agent**: only requests assigned to them; stages up to `awaiting_deposit`; enters the quote.
- **Operations & Finance**: requests from `awaiting_deposit` onward; verifies payments; stages to `completed`.

Hard gates: `awaiting_deposit` needs a quote; `order_processing`+ needs the deposit verified;
`ready_for_delivery`+ needs the 60% verified; quote locked after deposit verified (admin excepted).
Supabase's default grants were revoked; only needed privileges are granted back. If you add a table
or function, add its RLS policy **and** explicit grants, then run the Supabase security advisor.
The 5 advisor warnings about SECURITY DEFINER functions callable by `authenticated`
(`staff_role`, `staff_can_see`, `can_see_request`, `staff_can_see_request`, `add_staff`) are intentional.
So are the 2 warnings for `account_exists(email)` (callable without login): the homepage request form uses it
at step 3 to ask "your password" or "choose a password"; it returns only true/false, which signup already reveals.
Same for `published_reviews()` and `review_media_published(name)` (callable without login): the homepage reads approved
reviews and their media with them; they expose nothing about unapproved reviews or accounts.
Links typed by clients (`requests.product_link`, `profiles.store_link`) must be http(s) (DB check constraints);
pages only make a link clickable through `safeUrl()`. `request-files` accepts pictures and PDF, 10 MB max.

Team onboarding: the person signs up on `/account`, then an admin adds them in CRM → Team (RPC `add_staff`).
First admin: insert into `public.staff` from the SQL editor (see `docs/SETUP.md`).

## Testing

The pages were tested end to end against a local Postgres + PostgREST with Supabase stubs
(client signup from estimator → request with image → admin assigns → agent contacts and quotes
24,000 → deposit 9,600 / balance 14,400 → Ops verifies with proof → client sees "Order in production";
every forbidden action refused). For new work, test against the real project with test accounts,
or a Supabase branch; don't leave test data in production. CRM v2 (migration `20261024015046`) was
tested on the live project inside one transaction that ends with `raise exception` so it rolls back:
signup with `pending_request` creates the request (malformed one: signup still works, no request),
client/team message stamping, attachment folder checks, read markers, stage-change update messages,
costs refused for client and agent, other client and unassigned agent see nothing.

## To do next (in this order)

The owner's target process is **`docs/PROCESS.md`** (it wins over the code). Its section 5 lists what is
still to build; the items below are the infrastructure ones.


0. **Read `docs/PROCESS.md` first.** It is the owner's target process; its section 5 marks what is
   done. Still open there: restock, Orders page, invitations, notifications. Ask Yassine the open
   questions in its section 6 before building the parts they affect.

1. **Custom SMTP** (Resend) in Supabase Auth, so signup confirmation emails are reliable (Yassine postponed it).
2. **Privacy Policy** (`privacy.html`): mention client accounts, Supabase (EU hosting) for account,
   request, conversation and payment-tracking data, product images, and how to delete an account.
3. **Team alert on new request / new client message**: Supabase Database Webhook or Edge Function →
   email (and later WhatsApp) to the team. Secrets via `create_edge_function_secret`, never in code.
4. Nice to have: export requests/payments to CSV from the CRM; client email when the team replies.
