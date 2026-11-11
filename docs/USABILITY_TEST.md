# Usability test — 5 sellers, 15 minutes each

Goal: watch 5 real Moroccan e-commerce / COD sellers use the site and write down where they get stuck.
You do not explain the site. You watch, you listen, you take notes. If they are stuck, that is the result.

## Before the sessions (once, about 30 minutes)

1. **Pick 5 sellers** who do not know the site yet. Mix them: at least 2 who sell on COD every day, 1 who has
   never imported from China, 1 who prefers French, 1 who prefers Arabic.
2. **Use their own phone** (most clients will use a phone). Open the site in their usual browser.
3. **Prepare one test quote per seller** (for task 4):
   - Make a test account per seller with an email you control, for example `test1@…`, `test2@…`
     (log in to the account, send any request, e.g. "Test earbuds", 100 units).
   - In the CRM, open the request, enter a quote (e.g. MAD 12,000) and save it. It is now "sent to the client".
   - Note the email and password of each test account on paper. Log out before the session.
4. **After all sessions**: in the CRM, delete these test requests and test clients (CRM → Clients → Delete client),
   so no test data stays in production.
5. Have this page printed, or open on your laptop, to fill the tables.

## What to say at the start (1 minute)

> "Thank you for helping. We are testing the website, not you. There are no wrong answers.
> Please say out loud what you think and what you look for, even small things like 'I don't understand this word'.
> I will not help you, because I want to see where the site is not clear. You can stop at any time."

Start a timer for each task. Do not point, do not hint. If they are stuck for more than 2 minutes, say
"OK, let's move to the next one" and write down where they stopped.

## The 4 tasks (about 12 minutes)

Read each task out loud, exactly as written. Use the seller's language (French / Arabic / Darija) if they prefer.

| # | Task (read to the seller) | Success = | Target time |
|---|---|---|---|
| 1 | "You found a product on Alibaba that you want to sell. Send it to DDPSourcing to get a price." (give them any product link from Alibaba or 1688) | They complete the 3 steps of **Submit sourcing request** and see the confirmation. An account is created. | 4 min |
| 2 | "You paid the 40% deposit and you change your mind. Can you get your money back? Find the answer on the site." | They reach `/policies` (or the FAQ) and say the rule in their own words: cancel before we order from the supplier = the 40% is refunded in full; after we ordered = not possible. | 2 min |
| 3 | "Before sending money, you want to know who is behind DDPSourcing. Find who we are." | They find the company name, city and contact (homepage "How your money is protected" section, footer, or Terms). Note what they expected to find (photo, founder, address, registration numbers…). | 2 min |
| 4 | "Log in with this test account (give the email and password). DDPSourcing sent you a price. Accept it." | They log in, open the request, read the quote card, tick the Terms box and press **Accept**. They see the payment instructions. | 4 min |

Things to watch in every task:
- Where they tap first. Do they scroll a lot, or go back?
- Words they read out loud with doubt ("DDP?", "deposit?", "specs?").
- Do they trust the site? Do they say "I would send this on WhatsApp instead"?
- Anything too small to tap, or text hidden on the phone.

## Last questions (2 minutes)

1. "In one sentence, what does DDPSourcing do?"
2. "What would stop you from sending your first order?"
3. "What was the most confusing moment?"
4. "Out of 10, how likely are you to try it for a real order?"

Thank them. Do not defend the site, just write down the answers.

## Notes — one table per seller

**Seller:** ____  **Date:** ____  **Phone / browser:** ____  **Language:** EN / FR / AR  **COD seller:** yes / no

| Task | Done? (yes / with help / no) | Time | Where they got stuck (page, button, word) | What they said (quote) |
|---|---|---|---|---|
| 1 Send a request | | | | |
| 2 Find the refund rule | | | | |
| 3 Find who we are | | | | |
| 4 Accept the test quote | | | | |

| Question | Answer |
|---|---|
| What does DDPSourcing do? | |
| What would stop you? | |
| Most confusing moment | |
| Score /10 | |

## All problems found — fill after the 5 sessions

Write each problem once. Count how many sellers hit it. Fix first what blocked the most people.

| # | Problem (what happened) | Page | Task | Sellers who hit it (of 5) | How bad (blocked / slowed / small) | Idea to fix | Done |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |

**Rule of thumb:** if 2 or more of the 5 sellers hit the same problem, fix it before the next marketing push.
Send this filled table to Claude Code in a new session: "Read docs/USABILITY_TEST.md and fix the problems in order."

## Today's known gaps that may show up

- Task 3: the founder photo and story are hidden until you fill `founderName`, `founderStory` (and photo) in
  `assets/company.js`. The registration numbers (RC/ICE/IF) and the address are also still empty. Sellers will
  probably ask for them.
- Task 4: payment instructions show the bank details you typed in CRM → Settings. If they are empty, the test
  account will see "Our bank details will appear here very soon". Fill them before the sessions.
