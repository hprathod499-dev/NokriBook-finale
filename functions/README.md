# View-only premium — payment server

₹299 a year or ₹30 a month per buckle number; no free days. Promo codes (made in Super Admin) give % off; 100% = free.

## Switch-on order (do not change the order)
1. Firebase project on the Blaze plan.
2. Razorpay account activated (KYC done). Live API key id + secret.
3. Razorpay → Webhooks → add `https://asia-south1-duty-roaster-944b9.cloudfunctions.net/nbPremium/webhook`,
   events `order.paid` and `payment.captured`, pick a webhook secret.
4. Google Cloud → IAM → Service accounts → new account with roles: Cloud Functions Admin, Cloud Run Admin,
   Service Account User, Cloud Build Editor, Artifact Registry Administrator, Firebase Admin.
   Make a JSON key.
5. GitHub repo → Settings → Secrets → Actions: `FIREBASE_SERVICE_ACCOUNT` (the JSON),
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
6. Actions → "Deploy payment server" → Run workflow. Wait for green.
7. Make a promo code in Super Admin → Premium promo codes if you want one.
8. Test on one phone: open the view link, browser console `localStorage.nb_premium_on="1"`, reload.
9. Set `NB_PREMIUM_ON = true` in index.html and push.
10. Publish `firestore-premium.rules` in the Firebase Console (only now — before this the app
   does not ask for payment, so view-only users would be locked out with no way to pay).
