# DDPSourcing — Improvement plan: trust, legal clarity, UX, languages

Source: a client-side review by someone close to the owner (30 Oct 2026), checked against the live site
and the code. Their five remarks, and what we found:

| Remark | What the site shows today |
|---|---|
| 1. No trust or credibility: nothing shows the business is organised | No company details (address, RC, ICE), no phone, **no WhatsApp number** (setting empty), no email, no faces, one anonymous review, the footer names a different company ("Beast Capital Group") without explaining why |
| 2. Legal side unclear, for us and for the client | `terms.html` and `privacy.html` are live with the banner "This page is a starting template" and placeholders (`[DATE]`, `[X days]`, `[bank transfer / other]`, `[business email]`). Privacy says data is in Google Sheets (it is in Supabase now) |
| 3. 40% / 60% is good, but cancellation and refunds are unknown | Terms sections *Cancellation*, *Quality and claims*, *Liability* are placeholders. No rule for delays, failed inspection, customs problems, unpaid balance |
| 4. UX needs work; the site feels unfinished | Template banners, empty contact, English only, request bugs (see `docs/ROADMAP.md` section A), the client never sees or accepts the quote on the platform |
| 5. Add French and Arabic | English only, on every page and email |

The plan has 5 tracks. **Track 0 and Track 1 come first**: they remove the "unfinished" signals and
are mostly owner decisions plus content, little code.

---

## Track 0 — Quick wins this week (1–2 days)

- [ ] Fill `CONFIG.whatsappNumber` and `CONFIG.email` in `index.html` → WhatsApp button, footer contact.
- [ ] Remove every "starting template" banner and `[placeholder]` from live pages. Until the final
      texts are ready, publish the short version from Track 2 rather than a template.
- [ ] Fix ROADMAP section A bugs (lost request on signup, guest photos not uploaded, "Below min." flag).
- [ ] Explain the company in the footer and FAQ: "DDPSourcing is a service of **[legal entity]**,
      [city]. RC … · ICE … · IF …. Invoices are issued by [legal entity]." (Owner confirms the entity.)
- [ ] Delete test requests/accounts from production (owner confirms).
- [ ] Hide the "Reviews" link until there are at least 3 real reviews; keep Shipments (real photos).

## Track 1 — Trust and credibility

Goal: in 10 seconds a seller should see who we are, that we are real, and how their money is protected.

**On the homepage**
1. **"Who we are" section**: founder photo and name, short story, city, team on WhatsApp, company
   details (legal entity, RC, ICE, address). Real people, real numbers only — never invent figures.
2. **"How your money is protected" section** (next to pricing), linking to the full policy:
   - You pay nothing before you accept a written quote.
   - The 40% deposit only goes to a **company bank account** in the company name (show the bank name).
   - You see **photos/video of your goods inspected in China before they fly**, and you approve them.
   - If we cannot deliver what was agreed, you are refunded (summary of Track 3 rules).
   - Every payment gets a receipt; every order gets an invoice with ICE.
3. **Proof**: shipment photos per order (already supported), short videos (cartons arriving, unboxing),
   reviews collected after each delivery (flow already exists: account → CRM approval → homepage).
   Add a worked example with real numbers: "100 units of X → MAD … per unit, delivered in … days".
4. **Contact everywhere**: WhatsApp button (sticky on mobile), phone, email, business hours, address.
   Links to Instagram/Facebook/TikTok and a Google Business Profile if they exist.
5. **Visible process documents**: a sample quote, a sample inspection report, a sample invoice
   (with fake/blurred data clearly marked "example").

**In the client account**
6. Show the **final quote** with the full breakdown, validity date and terms version (see Track 3).
7. Show the **inspection photos/video** on the request before shipping, with "Approve" / "I have a
   question" buttons.
8. Show **payment receipts** (40% and 60%) once verified, and the invoice PDF.

## Track 2 — Legal clarity, both sides (owner + lawyer)

What is written here is a working structure, not legal advice. Have the final texts reviewed by a
lawyer in Morocco. Under Law 09-08, also check whether a declaration to the CNDP is required.

1. **Terms of Service (Conditions générales de vente)**, complete and dated, with:
   - parties and legal entity; what DDP includes and excludes;
   - how a quote becomes an order (client clicks "Accept" in the account → see Track 4);
   - quote validity (e.g. 7 days), price changes only before acceptance;
   - payment schedule, methods, bank account in the company name, receipts and invoices;
   - delivery time (15–20 days from deposit) and what counts as force majeure;
   - **cancellation and refunds** (Track 3), **claims** (deadline, proof, outcome), **liability cap**;
   - client duties: legal products, no counterfeit/brands without authorisation, correct information;
   - prohibited products list; governing law and competent court.
2. **Privacy Policy**: real data list (account, requests, photos, conversations, payment tracking,
   reviews), processors (Supabase EU/Ireland, Resend, Vercel), retention, rights under Law 09-08,
   how to delete an account, contact. Remove the Google Sheets mention.
3. **Per-order acceptance record**: when the client accepts a quote, store the date/time, quote
   amount, terms version and the user, so both sides have proof of what was agreed.
4. **Internal side ("pour nous")**: a one-page internal procedure for the team (when to refund, who
   approves, how to document a claim, which messages to send). Store it in `docs/` and link it in the CRM.

## Track 3 — 40% / 60% with clear cancellation and refund rules

Proposed default rules for the owner to decide (each line is a decision, then a lawyer check).
Write them in simple words on a public page `/policies` (FR/AR/EN) and in the Terms.

| Situation | Proposed rule (to validate) |
|---|---|
| Client cancels **before paying the 40%** | Free, nothing to pay. |
| Client cancels **after the 40%, before we order** from the supplier (e.g. within 24 h) | Deposit refunded in full (minus bank fees if any). |
| Client cancels **after the supplier order** is placed | Deposit not refundable (it paid the stock); goods can be delivered later on request, or resold with the client's agreement. |
| **We** cannot source the product, or the supplier fails | Full refund of the 40% within X business days. |
| **Inspection fails** (goods don't match the agreed specs) | Client chooses: replacement at our cost, or full refund of the 40%. Nothing flies without client approval. |
| **Delay**: no delivery 10 days after the promised date (outside force majeure) | Client may cancel and get the 40% back, or keep the order with a discount of X%. |
| **Customs problem** on a legal product correctly declared (DDP = our risk) | We handle it at our cost; if goods cannot be released, full refund. If caused by the client's product (counterfeit, prohibited, wrong info), client bears the loss. |
| Client does **not pay the 60%** within X days after customs clearance | Reminders, then storage fees after X days; after Y days the order is cancelled and the deposit is kept to cover costs. |
| **Damaged / missing / defective units** at delivery | Claim within 48–72 h with unboxing video/photos; refund or credit for affected units above a tolerance of X%. |
| Refund method and delay | Bank transfer to the client's account in X business days; proof shared in the account. |

**Platform changes for Track 3** (database + CRM + account):
- New request statuses: `cancelled_by_client`, `cancelled_by_us`, `refund_pending`, `refunded`, `claim_open`, `claim_closed`.
- `refunds` table (amount, reason, method, reference, proof, approved_by, date), team-only write; client sees the result.
- `claims` table (request, units affected, description, photos/video, outcome), client can open one from a delivered request.
- CRM: cancel / refund / claim actions in the request drawer, gated by role (admin approves refunds), logged in the activity.
- Dashboard: refunds and claims counters, refunds subtracted from profit.

## Track 4 — UX: a site that feels finished

1. **Quote acceptance inside the account** (biggest missing step): quote card with breakdown,
   validity, link to the policy, checkbox "I accept the Terms (version …)", **Accept** → status
   "Awaiting 40% deposit" + payment instructions; **Decline** / **Ask a question**. Team is notified.
2. **Payment proof upload** by the client for 40% and 60%; Ops verifies (verification already exists).
3. **Client emails** at each key moment (quote ready, deposit verified, shipped, cleared, delivered,
   team reply), with a WhatsApp link. Resend is already connected.
4. **Homepage clarity**: one primary action per screen, a short "How it works" in 3 icons above the
   fold, a worked price example, trust section (Track 1), FAQ updated with cancellation/refund answers.
5. **Account onboarding**: after the first login, a short checklist ("Request sent ✓ · We reply today
   · You will receive your quote here"), and an empty state that explains the next step.
6. **Polish**: 44 px tap targets on mobile, consistent button names everywhere, loading and error
   states on every button, fix "1 items", remove duplicate links.
7. **Usability test**: 5 real sellers try the site on their phone (send a request, find the refund
   rule, find who we are). Note where they hesitate; fix; repeat.

## Track 5 — French and Arabic

- **Order:** French first (most COD sellers read French), then Arabic (Modern Standard, right-to-left).
  Optional Darija for WhatsApp message templates and short marketing lines.
- **Structure:** static pages per language for search engines: `/` (EN), `/fr`, `/ar`, with
  `hreflang` tags, a language switcher in the header, and the choice remembered. Arabic pages use
  `dir="rtl"` and a font that supports Arabic (CSP already allows Google Fonts).
- **Scope:** homepage, estimator, account, policies, Terms, Privacy, emails (auth templates and
  notifications). The CRM can stay in English.
- **Implementation:** one dictionary file per language (`assets/i18n/fr.json`, `ar.json`) for the
  account and estimator scripts; translated HTML for the homepage and legal pages. Translations
  reviewed by a native speaker, legal texts by the lawyer.
- Store the client's language in `profiles.language` so emails and the account use it.

---

## Order of work and owner inputs

| Week | Work | Owner must provide |
|---|---|---|
| 1 | Track 0 + ROADMAP bugs | WhatsApp number, email, legal entity details (name, RC, ICE, address), confirm test data deletion |
| 1–2 | Track 1 homepage trust sections | Founder photo + short story, bank name, real photos/videos, social links |
| 2 | Track 3 rules decided + Track 2 texts drafted | Decisions on each line of the Track 3 table; lawyer review |
| 2–3 | Track 4 items 1–3 (quote acceptance, proof upload, client emails) + Track 3 platform changes | Payment instructions (bank account in company name) |
| 3–4 | Track 5 French | Native review |
| 4–5 | Track 5 Arabic, Track 4 polish, usability test with 5 sellers | 5 sellers willing to test |

Every database change: new migration in `supabase/migrations/`, RLS + explicit grants, security
advisor, tests (see `CLAUDE.md`). Clients never see costs, profit, internal notes or other clients' data.
