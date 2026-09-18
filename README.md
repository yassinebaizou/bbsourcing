# BeastSourcing website: how to put it online

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The homepage (all sections + the request form) |
| `privacy.html` | Privacy Policy (template, complete the [brackets]) |
| `terms.html` | Terms of Service (template, complete the [brackets]) |
| `favicon.svg` | The small icon in the browser tab |
| `media/` | Put your real shipment photos/videos and review videos here |
| `vercel.json` | Settings for Vercel (clean links, security headers) |

The site is plain HTML, so there's nothing to install or build.

---

## Step 1: Fill in your settings (5 minutes)

Open `index.html` in a text editor (Notepad, TextEdit, or directly on github.com with the pencil icon), and scroll to the bottom. Look for `const CONFIG`:

```js
const CONFIG = {
  formEndpoint: 'PASTE_YOUR_WEB_APP_URL_HERE',
  whatsappNumber: '',
  email: ''
};
```

- **formEndpoint:** your Google Apps Script Web App URL (the one ending in `/exec`, from the Sheet setup guide). This is what sends requests into your Sheet.
- **whatsappNumber:** your business WhatsApp, digits only, with 212. Example: `'212612345678'`. This shows the WhatsApp button and the number in the footer.
- **email:** your business email, or leave `''`.

## Step 2: Put it on GitHub

Your repository: `github.com/yassinebaizou/bsourcing`

1. Open the repository on github.com.
2. Open the `site` folder.
3. Click **Add file → Upload files**.
4. Drag in `index.html`, `privacy.html`, `terms.html`, `favicon.svg`, and the `media` folder. They replace the old files with the same name.
5. At the bottom, write "New BeastSourcing website" and click **Commit changes**.

**About `vercel.json`:** your repository already has one at the root, used for the `/team` dashboard password. Keep your existing one for now. If you no longer need the old `/team` dashboard (the Google Sheet replaces it), tell me and I'll give you a clean replacement.

Vercel detects the change and publishes the new site automatically within about a minute.

## Step 3: Connect your domain

In Vercel: **Project → Settings → Domains → Add**, type your domain (for example `beastsourcing.ma`), and follow the DNS instructions Vercel shows (usually one A record and one CNAME at your domain provider).

## Step 4: Test

1. Open the site on your phone.
2. Paste a product link in the top bar and click **Get my price**.
3. Fill in the form with test data and send it.
4. Check that a new row appears in the Sheet and that you receive the email.

---

## Adding real shipments and reviews later

The **Shipments** and **Reviews** sections stay hidden until you add real content, so the site never shows empty placeholders or invented reviews.

1. Upload the photos/videos into the `media` folder (photos under ~500 KB, videos under ~15 MB).
2. At the bottom of `index.html`, fill in the lists:

```js
const SHIPMENTS = [
  { type: 'image', src: 'media/arrival-casablanca.jpg', caption: 'Cartons received in Casablanca' },
  { type: 'video', src: 'media/unboxing.mp4', caption: 'Customer unboxing' }
];

const TESTIMONIALS = [
  { quote: 'The customer's own words', name: 'Customer name', store: 'Store name', city: 'Rabat' },
  { video: 'media/review-client.mp4', name: 'Customer name', store: 'Store name', city: 'Fès' }
];
```

Only use real, verified reviews, with the customer's permission.

---

## Before launch checklist

- [ ] `formEndpoint` set and a test request received in the Sheet
- [ ] WhatsApp number set
- [ ] Privacy Policy and Terms completed and reviewed by a legal professional
- [ ] Domain connected
- [ ] Tested on a phone
- [ ] Meta Pixel (optional): if you add your Pixel code in the `<head>`, the form already sends a **Lead** event when a request is submitted
