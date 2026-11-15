# Razorpay online payments — owner checklist

> **Status: written and unit-tested, but never run against real Razorpay.**
> The helpers in `functions/src/razorpay.ts` are covered by `npm run test:unit`
> (signatures, amounts, payload parsing). The two Cloud Functions in
> `functions/src/payments.ts` (`createRazorpayOrder`, `razorpayWebhook`) have only
> been type-checked. Treat the whole flow as **unverified until test-mode
> payments succeed end to end** (step 7).

The project is on the Firebase **Spark** plan, so Cloud Functions are not
deployed and online payment is off. Until then, paid events are settled
offline: the registration stays `pending_payment` and an organiser records the
payment by hand.

## How it works

1. A member registers for a paid event. The registration is saved as
   `pending_payment` / `pending`.
2. The app calls `createRazorpayOrder` with only the registration id. The
   function reads the **event's** price on the server (rupees, converted to
   paise), creates a Razorpay order and stores `razorpayOrderId` on the
   registration. It returns `{ orderId, amount, currency, keyId }`; the key id is
   public and comes from the function, not from an environment variable.
3. The member pays in Razorpay Checkout.
4. Razorpay calls `razorpayWebhook`. The function verifies the signature, then
   inside a transaction re-checks amount, currency, order id and status before
   marking the registration `paid` / `confirmed`. The browser can never confirm a
   payment itself, and members cannot write payment fields (see
   `firestore.rules`).
5. Anything that cannot be confirmed is written to the `paymentIssues`
   collection for a manual refund (see *Refunds*).

## 1. Upgrade to Blaze and cap the spend

Cloud Functions need the pay-as-you-go **Blaze** plan (Firebase console →
Usage and billing → Modify plan). Straight after upgrading, open Google Cloud
console → Billing → Budgets & alerts and create a budget (for example ₹500/month)
with email alerts at 50%, 90% and 100%. A budget only alerts; it does not stop
spending.

## 2. Create the Razorpay account (test mode first)

Sign up at razorpay.com and stay in **Test Mode** (toggle in the dashboard).
Generate test API keys under Account & Settings → API Keys. The key secret is
shown once; store it somewhere safe. Live mode needs completed KYC and is only
used at go-live (step 8).

## 3. Store the secrets

Run these yourself in a terminal and paste each value when prompted. Never paste
a key or secret into chat, a commit, an issue or a file in the repo.

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

`RAZORPAY_WEBHOOK_SECRET` is a long random string you choose now and enter again
in the Razorpay dashboard in step 5. They must be identical.

## 4. Deploy the two functions

```bash
cd functions && npm install && cd ..
firebase deploy --only functions:createRazorpayOrder,functions:razorpayWebhook
```

Both run in `asia-south1`. Note the `razorpayWebhook` URL printed at the end; it
looks like `https://razorpaywebhook-<hash>-el.a.run.app`.

## 5. Register the webhook in Razorpay

Dashboard → Account & Settings → Webhooks → Add new webhook:

- **URL:** the `razorpayWebhook` URL from step 4
- **Secret:** the same value you stored as `RAZORPAY_WEBHOOK_SECRET`
- **Events:** `payment.captured` and `order.paid`

Test and live mode have separate webhooks; create one in each when you get there.

Check in the Razorpay Payments settings that payments are **captured
automatically** (the default). If authorised payments are left for manual
capture, `payment.captured` never fires and nobody is confirmed.

## 6. Switch the button on in the app

The app only shows the pay button when the public build flag is set. In Vercel →
Project → Settings → Environment Variables add `VITE_ONLINE_PAYMENTS=true`
(Production and Preview) and redeploy. This is a public flag, not a secret. Leave
it unset (or `false`) while the functions are not deployed.

## 7. Test end to end in test mode

Do not skip this; nothing here has been exercised against Razorpay yet.

1. Create a paid test event (for example ₹10) and register with a test account.
2. Pay with a Razorpay test card or UPI test ID from the Razorpay docs
   (Test Mode → Payments → test cards). Try a success and a failure.
3. Confirm the registration becomes `confirmed` / `paid` with `razorpayPaymentId`
   and `paidAt`, and the ticket appears.
4. In the Razorpay dashboard open the webhook's delivery log and replay the same
   delivery. The registration must not change (the replay is a no-op).
5. Cancel a pending registration, then complete a payment against its old order if
   you can: nothing should confirm, and a `paymentIssues` document should appear.
6. Check `firebase functions:log` for `createRazorpayOrder` and `razorpayWebhook`
   errors after each step.

## 8. Go-live checklist

- [ ] Steps 1 to 7 pass in test mode
- [ ] Razorpay KYC and settlement bank account approved
- [ ] Live key id and key secret set with `firebase functions:secrets:set`, then
      redeploy the two functions so they pick up the new secret versions
- [ ] A live-mode webhook created with its own secret (update
      `RAZORPAY_WEBHOOK_SECRET` to match, then redeploy)
- [ ] One real low-value payment made and then refunded from the dashboard
- [ ] Budget alert from step 1 in place
- [ ] Privacy policy and Play Console answers updated (see below)
- [ ] Refund and cancellation wording agreed for paid events

## Refunds and `paymentIssues`

Refunds are issued from the Razorpay dashboard (Transactions → Payments →
Refund). The app does not issue refunds and does not yet mark a registration
`refunded` automatically.

If a payment arrives that must not confirm a seat, the webhook leaves the
registration untouched, logs a `logger.error`, replies 200 so Razorpay stops
retrying, and writes a document to the `paymentIssues` collection, keyed by the
Razorpay payment id so replays do not duplicate it. Review this collection in the
Firebase console regularly. Fields: `registrationId`, `razorpayPaymentId`,
`razorpayOrderId`, `reason`, `amount` (paise), `currency`, `userId`, `eventId`,
`resolved` (always `false` when written; set it by hand after refunding),
`createdAt`.

| `reason` | Meaning | Usual action |
| --- | --- | --- |
| `registration_cancelled` | Member cancelled before the payment arrived | Refund |
| `amount_mismatch` | Paid amount differs from the event's current price (for example the price was edited after the order was created) | Refund, or contact the member |
| `order_mismatch` | Paid against an order other than the latest one stored on the registration (for example Checkout opened twice and the older order was paid) | Check the payment; refund, or confirm by hand if it is genuine |
| `duplicate_payment` | The registration was already paid by a different payment | Refund the duplicate |
| `currency_mismatch`, `invalid_event_price`, `registration_not_pending`, `already_paid`, `event_missing`, `unknown_registration` | Unexpected state | Investigate in the logs, then refund |

`firestore.rules` does not grant any client access to `paymentIssues`; only the
Admin SDK and the console can read it.

## Play Console and privacy updates when payments go live

`docs/play-console.md` currently states the app has no payments. Revisit these
before enabling online payment in the Play build:

- **Data safety:** declare *Financial info → Purchase history* as collected
  (payment status and Razorpay payment/order reference, linked to the account,
  used for app functionality, not shared for advertising). Card, UPI and bank
  details are entered on Razorpay's Checkout and are processed by Razorpay; the
  app and our servers never see or store them. Razorpay is a third-party service
  that receives the payer's contact details and payment details, so list that
  sharing for payment processing. Keep "data encrypted in transit" as Yes.
- **Financial features:** the app now takes payments for event tickets. Re-answer
  the Financial features declaration accordingly (it is not a banking, loan or
  crypto app).
- **Payments policy:** tickets for in-person events are physical-world goods and
  services, so Google Play Billing is not required, but state this in the review
  notes and give reviewers a way to see the flow (test mode, or a free event).
- **Privacy policy** (`src/pages/legal`): name Razorpay as a payment processor,
  say what is stored (payment status, amount, Razorpay payment and order ids) and
  that card/UPI details are never stored by CrewDay, and describe refunds and how
  long payment records are kept.
- **Content Security Policy:** `vercel.json` already allows Razorpay Checkout in
  the Report-Only policy. Watch the browser console for violation reports during
  testing before turning the policy into an enforcing one.
- **Android app (TWA):** Checkout opens inside the Trusted Web Activity. Confirm in
  test mode on a real device that UPI app hand-off and the return to the app work.

## Known limits

- Only the latest Razorpay order id on a registration is accepted. If a member
  opens Checkout twice and pays the older order, the payment lands in
  `paymentIssues` instead of confirming automatically.
- The webhook does not send the member a notification or email when a payment
  confirms; they see the change in the app.
- Everything above is unverified against real Razorpay until step 7 is done.
