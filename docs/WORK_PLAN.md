# DDPSourcing — Work plan for Claude Code

Owner: Yassine Baizou. Written 30 Oct 2026 from the owner's answers. Background: `docs/IMPROVEMENT_PLAN.md`
(why), `docs/ROADMAP.md` (audit and bugs), `docs/PROCESS.md` (target process). **This file wins** where they differ.

How to use it: run **one sprint per Claude Code session**, in order. Each sprint ends with a pull request
that the owner merges. Paste the prompt given at the start of each sprint.

General rules for every sprint (also in `CLAUDE.md`):
- Branch from `main`, one PR per sprint, explain the PR in simple words for the owner.
- Database changes = new migration in `supabase/migrations/`, RLS + explicit grants, then the Supabase
  security advisor. Test with rolled-back transactions on the live project or a branch; never leave test data.
- Never invent company numbers, figures, reviews or photos. Leave a value empty (and hidden on the page) until the owner gives it.
- Clients never see costs, profit, internal notes or other clients' data.
- English stays the source language until Sprint 7; write every new text so it is easy to translate (no text inside images).

---

## 1. Owner decisions

| # | Topic | Decision | Status |
|---|---|---|---|
| D1 | Company that issues invoices | **Beast Capital Group** | ✅ owner |
| D2 | RC, ICE, IF, registered address | Owner will paste them. They must belong to the **same company** that issues the invoices (D1). | ⏳ waiting |
| D3 | Address shown on the site | **City only** (Casablanca). Full address only in the Terms. | ✅ owner (city to confirm) |
| D4 | Business email | **contact@ddpsourcing.com** | ✅ owner |
| D5 | WhatsApp number | Later. Keep WhatsApp buttons hidden until `CONFIG.whatsappNumber` is set. | ⏳ later |
| D6 | Bank | **CFG Bank**, account in the company name. The RIB is typed by the admin in the CRM (Sprint 3), never in code or chat. | ✅ owner |
| D7 | Payment method | **Bank transfer only** | ✅ owner |
| D8 | Quote validity | **7 days** | ✅ owner |
| D9 | Cancel before paying the 40% | **Free** | ✅ owner |
| D10 | Cancel after the 40%, before we order from the supplier | Full refund. | DEFAULT, to confirm |
| D11 | Cancel after we ordered from the supplier | **Not possible.** | ✅ owner |
| D12 | Problem on our side (cannot source, supplier fails, inspection fails, customs problem on a legal product, delivery we cannot make) | **Full refund, or a solution agreed with the client** (replacement, new delivery date). | ✅ owner |
| D13 | Inspection | Photos/video of the goods before shipping, shown in the client account; the client approves before the goods fly. | DEFAULT, to confirm |
| D14 | Delay | If not delivered 10 days after the promised date (outside force majeure), it counts as "problem on our side" (D12). | DEFAULT, to confirm |
| D15 | Unpaid 60% | Reminders; storage fee after 7 days; order cancelled after 30 days, deposit kept to cover costs. Fee amount: owner to set. | DEFAULT, to confirm |
| D16 | Damaged / missing units | Claim within **72 h** of delivery with unboxing video or photos; refund or credit for the affected units. | DEFAULT, to confirm |
| D17 | Refund delay | Bank transfer within **7 business days**. | DEFAULT, to confirm |
| D18 | Lawyer | Lawyer review **later**. Publish clear texts now (better than the template), mark nothing as "template". | ✅ owner |
| D19 | Trust content | **Testimonials from past clients** and/or a **"from China" section** (inspection, warehouse, packing). | ✅ owner |
| D20 | Founder photo and story on the site | Not answered. Build the section, keep it hidden until content is added. | ⏳ waiting |
| D21 | Languages | French first, then Arabic (Modern Standard, RTL). Default site language English. | DEFAULT, to confirm |
| D22 | Restock matching | Same client + same product link. | DEFAULT, to confirm |
| D23 | When an order exists | When the 40% deposit is verified. | DEFAULT, to confirm |
| D24 | Test data (DDP-1004, 1009, 1010 and their accounts) | Ask the owner before deleting. | ⏳ waiting |

All DEFAULT values must live in **one place** so the owner can change them without code:
a `business_settings` table edited from CRM → Settings (Sprint 3), read by the pages and the database rules.

---

## Sprint 1 — Fix the bugs and remove "unfinished" signals

**Status: done** (30 Oct 2026). Migration `20261030223353`, tests in `tests/`. Test data (D24) not deleted: waiting for the owner.

**Prompt to paste:**
> Read CLAUDE.md, docs/WORK_PLAN.md and docs/ROADMAP.md. Do Sprint 1 of docs/WORK_PLAN.md only. Open one pull request.

Tasks
1. ROADMAP A1 — lost request on signup:
   - page validation identical to the DB rule for links (http/https, no spaces; trim and encode spaces), quantity between 1 and 1,000,000;
   - `handle_new_user`: never block the signup, but save a failed `pending_request` in a new team-only table `failed_pending_requests` (user, payload, error, date) instead of dropping it; show it in the CRM dashboard "Needs attention";
   - on first login, if the client has no request but a failed one exists, `/account` reopens the form prefilled with a clear message.
2. ROADMAP A2 — photos of new visitors: keep the chosen photos in the browser (IndexedDB) and upload them automatically on the first login in `/account`, attached to the request; until uploaded, show "Photos waiting to upload" on the request. Fallback message only if the browser storage fails.
3. ROADMAP A3 — `below_minimum = quantity < 100 and coalesce(estimated_value_mad, 0) < 5000` (migration).
4. Footer and contact: email `contact@ddpsourcing.com` in `CONFIG.email`; company block read from one file `assets/company.js` (`legalName: 'Beast Capital Group'`, `city: 'Casablanca'`, `rc`, `ice`, `if`, `address` empty until the owner fills them; empty fields are not displayed). Footer text: "DDPSourcing is a service of Beast Capital Group, Casablanca. Invoices are issued by Beast Capital Group." + RC/ICE when present.
5. Remove the "This page is a starting template" banners and every `[placeholder]` from `privacy.html` and `terms.html` (Sprint 2 rewrites them; for now hide unfinished sentences).
6. Small UX: "1 items" → "1 item"; 44 px minimum height for links/buttons on mobile.
7. Ask the owner (in the PR description) whether to delete test data (D24). Do not delete without a yes.

Done when: the 3 bugs are reproduced by a test before the fix and pass after; no `[` placeholder or "template" text on any live page; footer shows the email and company line.

## Sprint 2 — Clear rules and legal pages

**Status: done** (31 Oct 2026). `/policies`, Terms `2026-11-v1`, Privacy, FAQ, `docs/LEGAL_REVIEW.md`. Numbers in `assets/policy.js`.

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 2 only. One pull request.

Tasks
1. New page **`/policies`** "Payments, cancellation and refunds", in simple words, built from D7–D17: a table "If… / What happens", a 40%/60% timeline, refund delay, how to make a claim, contact. Values read from the same settings as the database (start with a JS constants file until Sprint 3 adds `business_settings`).
2. Rewrite **`terms.html`** (CGV): parties (Beast Capital Group, RC/ICE from `assets/company.js`), service and what DDP includes/excludes, quote validity (D8), how a quote becomes an order (accept in the account, Sprint 3), payments (D6, D7), delivery time and force majeure, cancellation (D9–D11), our responsibility and refunds (D12–D14, D17), unpaid balance (D15), claims (D16), prohibited products, client duties, limitation of liability (simple, to be reviewed by the lawyer), governing law Morocco, courts of Casablanca, contact. Add a version number and date (`TERMS_VERSION = '2026-11-v1'`).
3. Rewrite **`privacy.html`**: real data (account, requests, photos, conversations, payment tracking, reviews), processors (Supabase EU/Ireland, Resend, Vercel), retention, rights under Law 09-08, how to delete an account (email contact@ddpsourcing.com), CNDP mention. Remove Google Sheets.
4. Homepage: FAQ answers for "Can I cancel?", "What if something goes wrong on your side?", "How do refunds work?", "Who issues my invoice?", each linking to `/policies`. Footer and request form link to `/policies`.
5. `docs/LEGAL_REVIEW.md`: list of the clauses the lawyer must check, and the open DEFAULT decisions.

Done when: no placeholder left; every rule on `/policies` matches the Terms; owner can read the rules in 2 minutes.

## Sprint 3 — Quote, acceptance and payment inside the account

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 3 only. One pull request.

Tasks
1. Migration: `business_settings` (single row: quote validity days, refund days, claim hours, storage-fee days, cancel-after days, bank name, account holder, RIB/IBAN, payment reference rule), admin write only; clients read only the payment fields, and only when they have a request awaiting a payment. CRM → **Settings** page to edit it.
2. Quote: when the team saves the quotation, store `quote_sent_at` and `quote_expires_at` (= sent + D8). The client account shows a **quote card**: total DDP price, price per unit, quantity, what is included, 40% and 60% amounts, expiry date, link to `/policies` and Terms.
3. **Accept / Decline / Ask a question** buttons. Accept requires the checkbox "I accept the Terms (version …)". Store a `quote_acceptances` row (request, user, amount, terms version, accepted_at) that nobody can edit or delete. Accept moves the request to `awaiting_deposit`; decline closes it with a reason; an expired quote cannot be accepted (team can resend).
4. Payment instructions shown after acceptance: CFG Bank, account holder, RIB, reference to write (request code). Client uploads the **transfer proof** (40% then 60%); Ops & Finance sees it and verifies (existing verification).
5. Team email on accept/decline and on proof uploaded (same pattern as `notify-new-request`).
6. Client can cancel **only before the 40% is verified** (D9/D10); the button disappears after.

Done when: full flow tested end to end (quote → accept → proof → verify), forbidden actions refused (client accepts an expired quote, edits an acceptance, sees another client's RIB data, cancels after supplier order).

## Sprint 4 — Cancellations, refunds and claims in the platform

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 4 only. One pull request.

Tasks
1. Statuses: `cancelled_by_client`, `cancelled_by_us`, `refund_pending`, `refunded`, plus claim states on delivered requests. Client-facing names in plain words.
2. `refunds` table (request, amount, reason from D12 list, method = bank transfer, reference, proof file, requested_by, approved_by, paid_at). Only admin approves; Ops records the transfer. Client sees amount, status and date.
3. `claims` table: client opens a claim on a delivered request within D16 hours (units affected, description, photos/video required); team answers with outcome (refund, credit, replacement, rejected with reason).
4. Rule D11 enforced in the database: no client cancellation once `order_processing` is reached.
5. D15: reminder messages when the 60% is due; CRM flag "storage fee from …" and "cancel after …" dates.
6. CRM: actions in the request drawer, counters on the dashboard, refunds subtracted from profit.

Done when: each D9–D17 situation has a tested path; activity log records every action.

## Sprint 5 — Trust on the homepage

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 5 only. One pull request.

Tasks
1. Section **"How your money is protected"** next to pricing: no payment before a written quote, transfer only to Beast Capital Group's CFG Bank account, inspection before shipping, refund rules (link `/policies`), invoice for every order.
2. Section **"From China to your door"** (D19): photo/video gallery of inspection, warehouse, packing, arrivals in Morocco. Reads from a list like `SHIPMENTS`; hidden while empty. Owner provides the media.
3. **Testimonials** (D19): make it easy to collect: CRM button "Ask for a review" on delivered requests (sends the client a link to Account → Leave a review). The homepage shows approved reviews only (existing flow).
4. Section **"Who we are"** (D20): founder, city, company line; hidden until the owner adds text and photo in `assets/company.js`.
5. Contact block: email, city, hours, WhatsApp when set, social links when set.
6. Inspection media on the request (D13): team uploads inspection photos/video in the CRM; the client sees them and clicks **Approve shipping** or **I have a question**; the team cannot move to `air_shipping` without the approval (admin override with a note).

Done when: a visitor sees who we are, how payments are protected and real proof in the first 3 screens on mobile.

## Sprint 6 — Client email notifications

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 6 only. One pull request.

Emails (Resend, branded like `docs/email-templates/`): request received, quote ready, quote expiring in 2 days, deposit verified, inspection ready to approve, shipped, cleared customs + 60% due, delivered + leave a review, refund paid, team reply in the conversation (grouped, max one email per 10 minutes). Client can turn off non-essential emails in the profile. Store the language for Sprint 7.

## Sprint 7 — French

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 7 only. One pull request.

`/fr` homepage, `/fr/estimate`, `/fr/policies`, `/fr/terms`, `/fr/privacy`; account and estimator texts in `assets/i18n/fr.json`; language switcher in every header; `hreflang` and `lang` attributes; `profiles.language`; emails in French when the client chose it. List the texts for a native review in the PR.

## Sprint 8 — Arabic

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 8 only. One pull request.

Same as Sprint 7 under `/ar` with `dir="rtl"`, an Arabic font allowed by the CSP, mirrored layouts checked on mobile, numbers and MAD amounts readable in RTL.

## Sprint 9 — UX polish and test with real sellers

**Prompt:** > Read CLAUDE.md and docs/WORK_PLAN.md. Do Sprint 9 only. One pull request.

Onboarding checklist after first login, empty states, loading and error states on every button, consistent button names, mobile pass on every page, page speed check, SEO basics (`robots.txt`, `sitemap.xml`, canonical, `og:image`, structured data). Then write `docs/USABILITY_TEST.md`: a 15-minute script for 5 sellers (send a request, find the refund rule, find who we are, accept a test quote) and a table to note problems.

## After Sprint 9 (from `docs/PROCESS.md`)

Restock (D22) with a "Reorder" button, Orders page with profit and CSV export (D23), invitations from the CRM, pro-forma/invoice PDF, Meta Pixel and analytics (update the CSP).

---

## What the owner still has to send

1. RC, ICE, IF and registered address of **the company that issues the invoices** (D1/D2).
2. WhatsApp Business number (D5), when ready.
3. Confirm or change each **DEFAULT** line in section 1.
4. Founder photo + 3–4 sentences, if you want the "Who we are" section (D20).
5. Photos/videos from China and of deliveries; names of past clients who agree to leave a review (D19).
6. Yes/no to delete the test data (D24).
