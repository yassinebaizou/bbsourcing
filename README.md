# DDPSourcing website

Live at **ddpsourcing.com**. Vercel publishes the `main` branch automatically, about a minute after each change.

## What's in this repository

| Path | What it is |
|---|---|
| `index.html` | The homepage. Its "Get my price" box sends visitors to `/account` |
| `estimate/` | The public price estimator (`/estimate`) |
| `account/` | The client area (`/account`). Visitors fill in their request first, then create their free account to send it. Clients follow their orders and chat with the team there |
| `team/` | The internal CRM (`/team`): dashboard, requests and orders, clients, payments, team |
| `api/estimate.js` | Estimator pricing, which runs on the server |
| `assets/` | Shared styles, Supabase settings (`config.js`), proof photos |
| `supabase/migrations/` | The database structure (Supabase project DDPSOURCING) |
| `docs/SETUP.md` | What still has to be set up in the dashboards |
| `privacy.html`, `terms.html` | Legal pages (complete the [brackets]) |
| `vercel.json` | Clean links and security headers. `/team` and `/account` are kept out of Google |

The site is plain HTML. There is nothing to install or build.

## Settings

At the bottom of `index.html`, look for `const CONFIG`:

- **whatsappNumber:** your business WhatsApp, digits only, with 212 (for example `'212612345678'`). This turns on the WhatsApp buttons.
- **email:** your business email, or `''` to hide it.

The Supabase address and public key are in `assets/config.js`. That key is safe to publish. Never put a secret key or `service_role` key in this repository.

## Adding shipments and reviews

The **Shipments** and **Reviews** sections stay hidden until you add real content. Put the files in `assets/proof/`, then fill in the `SHIPMENTS` and `TESTIMONIALS` lists at the bottom of `index.html`. Only use real, verified reviews, with the customer's permission.

## Before launch checklist

- [ ] WhatsApp number set
- [ ] Custom email sender (SMTP) set in Supabase, so confirmation emails are reliable (see `docs/SETUP.md`)
- [ ] Privacy Policy and Terms completed and reviewed by a legal professional
- [ ] One full test: a request sent from the homepage, answered in the CRM, and the answer seen in the client account
