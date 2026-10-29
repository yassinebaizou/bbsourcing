# DDPSourcing — Audit (30 Oct 2026) and development roadmap

Checked: the live homepage, the code on `main` (after PR #20), the Supabase project DDPSOURCING
(11 migrations, security and performance advisors, data, email-alert logs), and a full browser run of
homepage → estimator → client account → CRM on a local copy of the database built from all
migrations in `supabase/migrations/`. The live database functions match the repo (differences are
only SQL comments).

**What works well:** estimator (4 USD, 200 g gadget → 114 MAD, same as the pricing sheet), the 3-step
homepage request with account creation, auto-assignment to the admin, the new-request email (last
alerts sent on 27 Oct, HTTP 200), the client portal tabs (My requests, Submit sourcing request, Get
estimated price, Leave a review, My profile), the CRM (dashboard, requests & orders, clients, payments,
reviews, team), security headers and row-level security. No JavaScript errors, no horizontal scroll on
mobile.

---

## A. Bugs to fix first

| # | Bug | Proof | Fix |
|---|---|---|---|
| A1 | **A request can be lost silently.** If the request inside a new sign-up fails any database check, `handle_new_user` swallows the error: the account is created, the page says "Check your email to finish", but no request is saved. | Link `https://www.alibaba.com/product detail/x.html` (with a space) passes the page check (`new URL()` accepts it) but fails the DB rule `^https?://[^[:space:]]+$`. Result: account created, 0 requests. A quantity above 2,147,483,647 does the same. | Make the page check match the DB rule (no spaces; or encode the URL before sending). Cap quantity in the form. In `handle_new_user`, keep the signup safe but **record** the failed payload (e.g. a `failed_pending_requests` table, team-only) instead of dropping it, and show it in the CRM. On first login, `/account` should tell the client if their request is missing and reopen the prefilled form. |
| A2 | **Photos from new visitors are never uploaded.** Photos only upload when a session exists; a new visitor has none until they confirm their email. The form accepts "link **or** photos", so a request can arrive with **neither**. | Test request with 1 photo → `files=0`. The page asks the client to resend photos in the conversation later. | Keep the files in the browser (IndexedDB) and upload them automatically on the first login in `/account`, or upload them before signup to a short-lived "pending" folder through an Edge Function. Until then, require a product link for visitors who are not logged in. |
| A3 | **"Below minimum" flag missing.** `below_minimum = quantity < 100 and estimated_value_mad < 5000`. The form no longer asks for a value, so it is NULL and the flag is NULL. | Live DDP-1008 and DDP-1012 (50 units each) show no flag; local test with 50 units → `below_min=NULL`, 0 flags in the CRM. | New migration: `quantity < 100 and coalesce(estimated_value_mad, 0) < 5000`. |
| A4 | Small: dashboard shows "1 items"; mobile footer and nav links are under 36 px tall (hard to tap). | Screenshots. | Plural fix; 44 px minimum tap height. |

## B. Business and legal items (owner actions)

1. **Unanswered real requests.** In the CRM, DDP-1008 (26 Oct, unassigned: created before auto-assignment),
   DDP-1011 and DDP-1012 (27 Oct) have no status change, note or message after 2–3 days. If they were
   handled on WhatsApp, record it in the CRM so the dashboard and the client's account stay accurate.
2. **No WhatsApp number or email on the site.** `CONFIG.whatsappNumber` and `CONFIG.email` in
   `index.html` are empty, so no WhatsApp button appears anywhere, although the whole service promises
   WhatsApp contact. Fill them in.
3. **Privacy Policy is still the template and is outdated.** Live page shows "This page is a starting
   template…", placeholders (`[DATE]`, `[registered address]`, `[business email]`, `[business number]`,
   `[12 months]`), and says data is stored in Google Sheets/Drive. It must describe client accounts,
   Supabase (EU, Ireland), Resend for emails, product photos, conversations, payment tracking, reviews,
   and how to delete an account. Terms still have `[DATE]`, `[X days]`, `[Describe how claims…]`.
   Under Moroccan Law 09-08, check with a professional whether a CNDP declaration is needed.
4. **Legal entity.** The footer says "Invoices are issued by Beast Capital Group". Confirm this is the
   right entity before keeping it.
5. **Test data in production.** DDP-1004, DDP-1009 and DDP-1010 (and their test accounts) are still in
   the live database and count in the dashboard. Delete them once the owner confirms.
6. **Leaked-password protection** (Supabase → Authentication → Passwords) is off. It requires the
   Supabase Pro plan; turn it on when upgrading.

## C. What to build next (recommended order)

### Phase 1 — close the sales loop (highest impact)
1. **Quotation in the client account + "Accept quote" button.** Today the client never sees the final
   price on the platform (it goes through WhatsApp). Show the final DDP price, price per unit,
   40% / 60% amounts, payment instructions (bank details set by the admin), and an **Accept** button
   that moves the request to "Awaiting 40% deposit" and notifies the team. Also a **Decline / ask a
   question** option.
2. **Client uploads payment proof** (40% and 60%) from the account. Ops & Finance verifies in the CRM
   (verification already exists).
3. **Client email notifications** (PROCESS 4.6): team reply, status change, quote ready, payment
   verified. Resend is already connected for the team alert; reuse it. Add the WhatsApp link in each email.
4. **Team alert on new client message** (same Edge Function pattern as `notify-new-request`).

### Phase 2 — operations (PROCESS 3, 4.3, 4.5)
5. **Restock**: "Reorder" button on each delivered request in the client account (prefilled copy),
   plus automatic matching (same client + same product link) that flags it as Restock and prefills the
   last final price per unit. Needs owner answer to PROCESS open question 1.
6. **Orders page** in the CRM: one row per confirmed order, selling price, costs, profit, margin,
   payment state, days since deposit, late flag; CSV export for accounting.
7. **Invitations**: admin creates a client (or team member) from the CRM and the person receives an
   email to set their password (Edge Function with the service key stored as a secret).
8. **Quotation PDF / pro-forma invoice** generated from the request (logo, client, product, price,
   40/60 schedule, legal entity), downloadable by client and team.

### Phase 3 — growth
9. **French and Arabic/Darija versions** of the homepage and client account. Most Moroccan COD sellers
   read French first; English only limits conversion. Start with French.
10. **SEO basics**: `robots.txt`, `sitemap.xml`, canonical URL, `og:image` share picture, structured
    data (Organization, Service, FAQ), Google Search Console. Optional: a small blog/guides section
    ("How to import from China to Morocco", "What is DDP", "Customs duties for…").
11. **Tracking**: Meta Pixel / Conversions API and Google Analytics with consent, events for
    estimate done, request submitted, account confirmed, quote accepted. The form already fires
    `fbq('track','Lead')` if the Pixel exists, and the CSP must be updated to allow it.
12. **More proof on the homepage**: the Reviews flow exists (client → CRM approval → homepage); ask
    each delivered client for a review, and add shipment photos per order from the CRM.
13. **Estimator improvements**: show the per-unit breakdown range, MOQ hint (below 100 units), and a
    "Save this estimate" that creates a draft request in the account; keep pricing server-side.
14. **Client loyalty**: order history with total spent, "15-day restock" reminders (an existing
    client's testimonial already asks for this), referral code.
15. **WhatsApp Business API** (later): send status updates and quote links on WhatsApp automatically.

### Technical hygiene
- Add a `pending` request recovery test and a photo-upload test to the test notes in `CLAUDE.md`.
- Remove unused indexes only after real traffic (advisor shows 14 unused, normal for a new database).
- Merge the two permissive policies on `profiles` (update) and `request_files` (insert) into one each
  (advisor performance warning).
- Keep the 5 + 3 SECURITY DEFINER advisor warnings documented as intentional.
