# DDPSourcing — Target business process (v2)

Written from Yassine's description (owner). This is the process the website, the Supabase
database and the internal CRM must follow. Where this document and the current code disagree,
**this document wins**. Open questions are listed at the end; ask Yassine before guessing.

---

## 1. Public website (homepage)

### 1.1 "Get my price" = the real request
- The homepage keeps its **Get my price** buttons. Clicking one **scrolls down to the request form
  on the homepage** (it does not leave the page).
- In the form, the visitor fills in:
  - **product information** (link, name, category, quantity, specifications, images, etc.)
  - **personal information** (name, WhatsApp, city, etc.)
- To **submit**, the visitor **must create an account** (or log in if they already have one).
  No anonymous requests.
- After the account is created and the **email is confirmed**, the request is sent and:
  - it appears in the **CRM** for the team;
  - the client can follow it in **their account** on the platform.
- From then on, all exchanges about that request happen **on the platform**, between the client
  and either Yassine or the team member **assigned** to the request.

> Already in place on `main`: the request travels in the signup metadata (`pending_request`) and is
> inserted by the `handle_new_user` trigger, so it is saved even if the client confirms the email on
> another device. Reuse this mechanism for the homepage form.

### 1.2 "Guest estimation" (no account)
- The **top navigation bar** has a **Guest estimation** button.
- It opens the price estimator (`/estimate`): anyone can get an **indicative price** without an
  account and without sending a request.

### 1.3 Two different actions, clearly separated
| Button | For whom | Result |
|---|---|---|
| **Get estimation** / Guest estimation | Someone who wants to **test** a product idea | Indicative price only. Nothing is sent to the team. |
| **Get my price** / **Get my quote** | Someone who is **sure** they want to source the product | A real request → CRM → final DDP quotation |

---

## 2. Client account

Inside the client account there must be:
- **Get estimation**: the same estimator, so the client can test products at any time without
  sending a request.
- **Get my quote**: a new real request (for products they are sure about).
- **My requests**: every request with its **current status**, updated live by the team.
- **Messages** per request: the client can ask a question about a request; the team answers there.

### 2.1 Status visible to the client

*Done:* client-facing stage names updated to this list (migration `20261024022909_client_stage_names_v2`).
Every status the team sets in the CRM is **shown to the client**, in plain words, so they always
know where their product is. Examples:
- In review
- Approved
- Quotation sent / waiting for 40% deposit
- In production / quality inspection
- **Shipped to Morocco**
- **Arrived in Morocco – in customs clearance**
- Waiting for 60% payment
- Out for delivery / Delivered

---

## 3. When a request arrives (team side)

1. The team **checks the client's information**.
2. The team checks whether the product is:
   - **sourced for the first time** → normal sourcing process; or
   - **already sourced before** (for this client) → it becomes a **Restock**.
3. **Restock rule:** if the product was already sourced, the request goes **automatically** to the
   **restock** path, and the **price from the previous sourcing** is reused for the new quotation,
   **unless the shipping price has changed** (then the team updates the price).

---

## 4. Internal CRM

At the start **Yassine is the only user (Administrator)** and does everything. Team members are
added later with limited access.

### 4.1 Dashboard (first screen)
An overview of the whole business:
- number of requests, **answered** vs **not answered yet**;
- requests by stage;
- orders and their status;
- payments: 40% deposits received / missing, 60% balances received / missing;
- profit figures (see Orders).

### 4.2 Requests (below the dashboard / own page)
Manage **each request individually**:
- current **status** and where it is blocked;
- **40% paid or not**, **60% paid or not**;
- **answered or not** (has the team replied to the client?);
- assignment to a team member;
- **Messages** with the client (same thread the client sees in their account);
- changing the status here updates what the client sees immediately.

### 4.3 Orders
- An **order** is the deal between DDPSourcing and the client. It is **linked directly to its
  request** (one confirmed request → one order).
- The order section is where the team records the order figures and **calculates DDPSourcing's
  profit** per order (selling price to the client vs. real costs).

### 4.4 Clients
A page listing every client, and for each client:
- number of operations (requests and orders) done with them;
- total business volume with them;
- **total profit** made with them;
- their history of requests/orders.

### 4.5 Users and access management
- Manage **all users**: clients and team members.
- The admin can **create a client account internally** and **send the client an invitation**
  from the platform (the client receives an email and sets their own password).
- The admin can invite team members and set their **access level** (role), and disable access.

### 4.6 Notifications (phase 2, can come later)
- When the team replies to a client, or the status changes, the client receives an **email
  notification**.
- The team receives a notification for every new request and every new client message.

---

## 5. What already exists vs. what must be built

**Already on `main`** (PR #6 + CRM v2, PR #7) — check the code before rebuilding any of it:
client accounts; request filled first, account created at the last step (request saved through
signup metadata); client-facing statuses, with stage changes posted to the client conversation;
two-way conversation per request with unread badges; CRM dashboard (period KPIs, needs-attention
list, 12-month sales/profit chart, pipeline, team performance); requests table and board with
filters; clients view with totals and profit; costs & profit per request; 40/60 payments with
proof; assignment, notes, activity log; team management; noindex on `/team` and `/account`.

**Still to build**, in this order:
1. ✅ *Done.* **Homepage form (1.1)**: "Get my price" must **scroll down to a request form on the homepage**
   (product + personal information), not leave the page. At submit, the visitor creates the account
   (same `pending_request` flow as `/account`), then lands in their account with the request visible.
2. ✅ *Done.* **"Guest estimation" button in the top navigation bar** (1.2), opening `/estimate`.
3. ✅ *Done.* **"Get estimation" inside the client account** (2): a visible button/tab, next to
   "Get my quote", so clients can test prices without sending a request.
4. **Restock (3)**: when a request arrives for a product this client already sourced, flag it as
   Restock automatically and prefill the quotation with the previous final price; the team adjusts
   it only if shipping costs changed. (Matching rule: see open question 1.)
5. ✅ *Done* (CRM "Reply" column, filter, dashboard "Not answered"). **Answered / not answered** (4.2): make sure the requests list and dashboard show clearly which
   requests have a client message with no team reply yet.
6. **Orders page (4.3)**: a dedicated Orders view listing every confirmed order (linked to its
   request) with selling price, costs, profit and payment state; today costs & profit live only in
   the request drawer.
7. **Users and invitations (4.5)**: from the CRM, the admin can create a client account and send an
   email invitation (client sets their own password), invite team members with a role, and disable
   access. Needs a server-side function (Supabase Edge Function with the service key stored as a
   secret, never in the website code).
8. **Email notifications (4.6)**: client email on team reply / status change; team email on new
   request / new client message. Requires the custom SMTP sender first (Resend).

All database changes = new migration files in `supabase/migrations/`, with RLS policies and
explicit grants, then the Supabase security advisor (see `CLAUDE.md`). Clients must never see
costs, profit, internal notes or other clients' data.

## 6. Open questions for Yassine

1. **Restock matching**: how do we know it is "the same product"? Same client + same product link?
   Or the team marks it manually? Can a restock come from **another** client who sourced the same
   product?
2. **Profit**: which real costs are entered per order (supplier price, shipping, customs, transit,
   other fees)? Entered by whom (Ops & Finance)?
3. **Orders vs requests**: is an order created when the client accepts the quotation, or when the
   40% deposit is verified?
4. **Invitations**: when you create a client internally, can you also create a request on their
   behalf?
5. **Messages**: may the client attach files in messages (photos, payment proof)?
