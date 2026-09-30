# Nokri Book — email sender (Cloudflare Worker)

Sends the "Format all data" confirmation email. Replaces EmailJS.

**Why it's safe:** the secret email key lives only on Cloudflare (not in the
web page). The Worker checks the user's Firebase login and only ever emails
**that user's own verified address**, with a fixed message. Nobody can use it
to send spam or other content to anyone else.

Free: Cloudflare Workers (100,000 requests/day) + Resend (3,000 emails/month).

## One-time setup

### 1. Resend (the email service)
1. Sign up at https://resend.com (free).
2. **Domains → Add Domain →** `nokribook.in`.
3. Resend shows a few DNS records (TXT and MX). Add each one in
   **GoDaddy → nokribook.in → DNS → Add record**, exactly as shown.
4. Back in Resend, click **Verify** (can take a few minutes).
5. **API Keys → Create API Key** (permission: *Sending access*) → copy it.

### 2. Cloudflare Worker
1. https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker**.
2. Name it `nokribook-email` → **Deploy**.
3. **Edit code** → delete everything → paste all of `src/worker.js` → **Deploy**.
4. **Settings → Variables and Secrets → Add**:

   | Name | Type | Value |
   |---|---|---|
   | `RESEND_API_KEY` | **Secret** | the key from Resend |
   | `FROM_EMAIL` | Text | `Nokri Book <noreply@nokribook.in>` |
   | `FIREBASE_PROJECT_ID` | Text | `duty-roaster-944b9` |
   | `ALLOWED_ORIGINS` | Text | `https://nokribook.in,https://www.nokribook.in` |

5. Copy the Worker's address (like `https://nokribook-email.<you>.workers.dev`).
   Opening it in a browser should show `{"ok":true,"service":"nokribook-email"}`.

### 3. Connect the app
In `index.html`, set:
```html
window.NB_EMAIL_WORKER_URL = "https://nokribook-email.<you>.workers.dev";
```
Until this is set, the app opens a pre-filled email draft instead.

## Notes
- Accounts whose email isn't verified (email/password sign-ups while
  verification is off) get the email-draft fallback. Google sign-ins are
  always verified.
- Tests: `cd email-worker && npm test`
