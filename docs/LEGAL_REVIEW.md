# Legal review — what the lawyer must check

Owner: Yassine Baizou. Prepared 31 Oct 2026 (Sprint 2 of `docs/WORK_PLAN.md`). The live texts are
`terms.html` (version `2026-11-v1`), `privacy.html` and `policies.html`. All numbers come from one
file, `assets/policy.js` (moved to CRM → Settings in Sprint 3). Decisions D1–D24 are in
`docs/WORK_PLAN.md`, section 1.

Bring this page, the three pages printed (or their links) and the company documents (RC, ICE, IF,
statuts of Beast Capital Group) to the lawyer.

## 1. Decisions still to confirm by the owner

These rules are already on the site, written as the work plan's DEFAULT values. Confirm or change
each one (change it in `assets/policy.js` or tell Claude), then the lawyer checks the wording.

| # | Rule as published | Where |
|---|---|---|
| D10 | Cancel after the 40%, before we order from the supplier: full refund. | Terms §8, /policies |
| D13 | Inspection: photos or video before shipping; goods ship after the client approves. | Terms §7, /policies |
| D14 | Not delivered 10 days after the promised date (outside force majeure) = problem on our side → full refund or agreed solution. | Terms §9, /policies, FAQ |
| D15 | Unpaid 60%: reminders; storage fee after 7 days; order cancelled after 30 days, deposit kept. **Storage-fee amount not set: the sentence with the amount stays hidden until the owner gives it.** | Terms §10, /policies |
| D16 | Damaged / missing units: claim within 72 h with unboxing video or photos → refund or credit for the affected units. | Terms §11, /policies, FAQ |
| D17 | Refund by bank transfer within 7 business days after the refund is confirmed. | Terms §9, /policies, FAQ |
| D21 | Languages: French first, then Arabic; English stays the default. | Sprints 7–8 |
| D23 | An order exists when the 40% deposit is received. | Terms §4 |

Also written in the Terms but not in the owner's decision list (added because a complete CGV needs
them). **Confirm or remove:**

| Clause | Text (summary) | Where |
|---|---|---|
| Not included in the price | Changes asked after acceptance; the storage fee. | Terms §2 |
| Refused products | We may refuse or cancel before ordering; amount paid refunded in full. | Terms §12 |
| Client's fault | Goods blocked because the product is not allowed or the information was wrong: not a problem on our side, costs not refunded. | Terms §13 |
| Liability cap | Total liability limited to the amount paid for the order; no indirect losses (lost sales, profit). | Terms §14 |
| Version rule | The Terms version in force when the client accepts the quote applies to that order. | Terms §16 |
| Retention | Account data kept while the account is open; order/payment records for the period required by accounting and tax rules. | Privacy |

## 2. Clauses the lawyer must check

1. **Parties and identity (Terms §1, footer, Privacy).** "DDPSourcing is a service of Beast Capital
   Group, Casablanca." Is it correct and enough to sell under the DDPSourcing brand? Which legal
   mentions are compulsory on the website and on invoices (RC, ICE, IF, capital, registered address,
   legal form)? They are filled in `assets/company.js` once the owner gives them.
2. **Consumer or business clients.** Most clients are sellers (professionals), but some may be
   individuals. Does Law 31-08 (consumer protection) apply, in particular the right of withdrawal,
   and does Terms §8 (no cancellation after the supplier order) need an exception for consumers?
3. **DDP scope (Terms §2).** Is "Delivered Duty Paid" used correctly for a domestic delivery that
   includes the import? Are the included/excluded items complete (duties, VAT on import, local taxes)?
4. **Quote and order formation (Terms §3–4).** Validity of acceptance in the client account (Sprint 3
   records date, amount, Terms version and user) or "in writing" (WhatsApp, email) as proof of the
   contract.
5. **Payments (Terms §5).** 40% / 60% schedule, bank transfer only to the company account, invoice
   issuer. Anything required for deposits (arrhes vs acompte) and their legal effect on cancellation.
6. **Force majeure (Terms §6).** Definition and consequences under the Moroccan Code of Obligations
   and Contracts (DOC).
7. **Cancellation and refunds (Terms §8–9).** Wording of each case, refund delay (D17), and the
   "solution you agree with" alternative.
8. **Unpaid balance (Terms §10).** Is keeping the deposit after 30 days valid (penalty clause, proportion
   to real costs)? Storage-fee amount and how it is communicated.
9. **Claims (Terms §11).** 72-hour deadline and proof required: valid against professionals and
   consumers?
10. **Prohibited products and client duties (Terms §12–13).** Intellectual property, counterfeit,
    products needing import authorisations (ONSSA, ANRT for connected devices, etc.).
11. **Limitation of liability (Terms §14).** Enforceability and wording.
12. **Governing law and courts (Terms §17).** Moroccan law, courts of Casablanca.
13. **Privacy (Law 09-08).**
    - Is a **declaration or authorisation with the CNDP** required for client accounts, requests,
      conversations, payment tracking and reviews?
    - **Transfers outside Morocco:** Supabase (EU, Ireland), Resend and Vercel (may process data
      outside Morocco), Google Fonts. Is a CNDP authorisation needed for these transfers?
    - Retention periods (accounting and tax rules for invoices and payments).
    - Consent wording for WhatsApp contact and for publishing reviews (name, photo, video).
14. **Reviews.** Consent for publishing a client's review with their name, city, store and media.

## 3. After the review

- Update the texts with the lawyer's changes, raise the version (`termsVersion` in
  `assets/policy.js`, for example `2026-12-v2`) and the date.
- Orders accepted under an older version keep that version (Terms §16).
