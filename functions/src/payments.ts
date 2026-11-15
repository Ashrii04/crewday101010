/**
 * CrewDay — Razorpay online payments
 * ============================================================================
 *
 * DORMANT. The project is on the Spark plan, so none of this is deployed; it
 * is written and tested so payments can go live the day the owner upgrades to
 * Blaze. See docs/razorpay-setup.md for the go-live steps. It has not been run
 * against real Razorpay.
 *
 * Flow:
 *   1. The member registers for a paid event; the client writes a registration
 *      with `pending_payment` / `pending`.
 *   2. `createRazorpayOrder` creates a Razorpay order for the EVENT's price and
 *      stores the order id on the registration.
 *   3. After Checkout succeeds, Razorpay calls `razorpayWebhook`. Only that
 *      webhook — the Admin SDK, after verifying the signature and re-checking
 *      the amount — confirms the registration. The browser never does.
 *
 * Secrets come from Secret Manager via `defineSecret`; nothing is in the repo.
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import {
  CURRENCY,
  MIN_ORDER_PAISE,
  extractPaymentEntity,
  paymentMismatchReason,
  toPaise,
  verifyWebhookSignature,
  type PaymentEntity,
  type PaymentMismatch,
} from './razorpay'

const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID')
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET')
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET')

const REGION = 'asia-south1'
const ORDERS_URL = 'https://api.razorpay.com/v1/orders'

/** Firestore auto ids and `eventId__uid` ids; also keeps a path out of the id. */
const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/

/**
 * Module scope runs before index.ts calls `initializeApp()` (imports are
 * hoisted), so the database is fetched lazily from inside the handlers.
 */
function getDb() {
  if (!getApps().length) initializeApp()
  return getFirestore()
}

/** A secret's value, or '' when it is not set (e.g. in the emulator). */
function secretValue(secret: { value(): string }): string {
  try {
    return secret.value() ?? ''
  } catch {
    return ''
  }
}

/* -------------------------------------------------------------------------- */
/*                               Create an order                              */
/* -------------------------------------------------------------------------- */

interface RazorpayOrderResponse {
  id?: unknown
  amount?: unknown
  currency?: unknown
}

/**
 * Start a payment for the caller's own pending registration.
 *
 * The amount is derived here from the event document. The client sends only the
 * registration id, so there is no amount to tamper with.
 */
export const createRazorpayOrder = onCall<{ registrationId?: string }>(
  { region: REGION, maxInstances: 10, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
    const uid = request.auth.uid

    const registrationId = request.data?.registrationId
    if (typeof registrationId !== 'string' || !DOC_ID.test(registrationId)) {
      throw new HttpsError('invalid-argument', 'A valid registration is required.')
    }

    const keyId = secretValue(RAZORPAY_KEY_ID).trim()
    const keySecret = secretValue(RAZORPAY_KEY_SECRET).trim()
    if (!keyId || !keySecret) {
      logger.error('Razorpay keys are not configured.')
      throw new HttpsError('failed-precondition', 'Online payments are not set up yet.')
    }

    const db = getDb()
    const registrationRef = db.collection('registrations').doc(registrationId)
    const registrationSnapshot = await registrationRef.get()
    if (!registrationSnapshot.exists) {
      throw new HttpsError('not-found', 'Registration not found.')
    }
    const registration = registrationSnapshot.data() ?? {}

    // Only the member who owns the seat may pay for it.
    if (registration.userId !== uid) {
      throw new HttpsError('permission-denied', 'This registration is not yours.')
    }
    if (
      registration.registrationStatus !== 'pending_payment' ||
      registration.paymentStatus !== 'pending'
    ) {
      throw new HttpsError('failed-precondition', 'This registration is not awaiting payment.')
    }

    const eventId = registration.eventId
    if (typeof eventId !== 'string' || !DOC_ID.test(eventId)) {
      throw new HttpsError('failed-precondition', 'This registration has no valid event.')
    }
    const eventSnapshot = await db.collection('events').doc(eventId).get()
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'This event no longer exists.')
    const event = eventSnapshot.data() ?? {}
    if (event.status !== 'open' && event.status !== 'closed') {
      throw new HttpsError('failed-precondition', 'This event is no longer taking payments.')
    }

    let amount: number
    try {
      amount = toPaise(event.price)
    } catch {
      logger.error(`Event ${eventId} has an unusable price`, event.price)
      throw new HttpsError('failed-precondition', 'This event has no valid price.')
    }
    if (amount < MIN_ORDER_PAISE) {
      throw new HttpsError('failed-precondition', 'This event does not need an online payment.')
    }

    let response: Response
    try {
      response = await fetch(ORDERS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          currency: CURRENCY,
          // Razorpay caps the receipt at 40 characters; ids are plain ASCII.
          receipt: registrationId.slice(0, 40),
          notes: { registrationId, eventId, userId: uid },
        }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      logger.error('Razorpay order request failed', error)
      throw new HttpsError('unavailable', 'Could not reach the payment provider. Try again.')
    }

    if (!response.ok) {
      // The error body is Razorpay's own description; it contains no secrets.
      const detail = await response.text().catch(() => '')
      logger.error(`Razorpay order creation returned ${response.status}`, detail.slice(0, 500))
      throw new HttpsError('internal', 'Could not start the payment. Try again.')
    }

    const order = (await response.json().catch(() => ({}))) as RazorpayOrderResponse
    if (
      typeof order.id !== 'string' ||
      !order.id ||
      order.amount !== amount ||
      order.currency !== CURRENCY
    ) {
      logger.error('Razorpay returned an unexpected order', order)
      throw new HttpsError('internal', 'Could not start the payment. Try again.')
    }

    // Last order wins. The webhook only confirms a payment made against the
    // order id stored here.
    await registrationRef.update({
      razorpayOrderId: order.id,
      updatedAt: FieldValue.serverTimestamp(),
    })

    logger.info(`Created Razorpay order ${order.id} for registration ${registrationId}`)
    return { orderId: order.id, amount, currency: CURRENCY, keyId }
  },
)

/* -------------------------------------------------------------------------- */
/*                                   Webhook                                  */
/* -------------------------------------------------------------------------- */

type Outcome = 'confirmed' | 'already_processed' | 'unknown_registration' | 'flagged'

/**
 * Apply one captured payment inside a transaction.
 *
 * Reads come first, then writes. A payment that cannot be confirmed is never
 * dropped silently: it is logged and written to `paymentIssues` (one document
 * per Razorpay payment id, so replays do not pile up) for a manual refund.
 */
async function applyCapturedPayment(payment: PaymentEntity): Promise<Outcome> {
  const db = getDb()
  const issueRef = db.collection('paymentIssues').doc(payment.paymentId)

  const flag = (
    transaction: FirebaseFirestore.Transaction,
    reason: PaymentMismatch | 'unknown_registration' | 'event_missing' | 'duplicate_payment',
    alreadyFlagged: boolean,
    context: { userId?: string; eventId?: string } = {},
  ): Outcome => {
    logger.error(
      `Razorpay payment ${payment.paymentId} (order ${payment.orderId}, ${payment.amount} paise) ` +
        `NOT applied to registration ${payment.registrationId}: ${reason}. Refund manually if needed.`,
    )
    if (!alreadyFlagged) {
      transaction.set(issueRef, {
        registrationId: payment.registrationId,
        razorpayPaymentId: payment.paymentId,
        razorpayOrderId: payment.orderId,
        reason,
        amount: payment.amount,
        currency: payment.currency,
        userId: context.userId ?? '',
        eventId: context.eventId ?? '',
        resolved: false,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    return reason === 'unknown_registration' ? 'unknown_registration' : 'flagged'
  }

  return db.runTransaction(async (transaction) => {
    const registrationRef = db.collection('registrations').doc(payment.registrationId)
    const [registrationSnapshot, issueSnapshot] = await Promise.all([
      transaction.get(registrationRef),
      transaction.get(issueRef),
    ])
    const alreadyFlagged = issueSnapshot.exists

    if (!registrationSnapshot.exists) return flag(transaction, 'unknown_registration', alreadyFlagged)
    const registration = registrationSnapshot.data() ?? {}
    const context = { userId: registration.userId, eventId: registration.eventId }

    // A replay of a payment we already applied is a successful no-op.
    if (registration.paymentStatus === 'paid' && registration.razorpayPaymentId === payment.paymentId) {
      return 'already_processed'
    }
    // Paid already, but by a different payment: a second charge to refund.
    if (registration.paymentStatus === 'paid') {
      return flag(transaction, 'duplicate_payment', alreadyFlagged, context)
    }

    const eventId = registration.eventId
    const eventSnapshot =
      typeof eventId === 'string' && DOC_ID.test(eventId)
        ? await transaction.get(db.collection('events').doc(eventId))
        : null
    if (!eventSnapshot?.exists) return flag(transaction, 'event_missing', alreadyFlagged, context)

    // The expected amount is the event's current price, never the payload's.
    const reason = paymentMismatchReason(payment, registration, eventSnapshot.data())
    if (reason) return flag(transaction, reason, alreadyFlagged, context)

    transaction.update(registrationRef, {
      paymentStatus: 'paid',
      registrationStatus: 'confirmed',
      paymentMethod: 'razorpay',
      paymentReference: payment.paymentId,
      razorpayPaymentId: payment.paymentId,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return 'confirmed'
  })
}

/**
 * Razorpay → us. Authenticity first: the signature is checked against the raw
 * bytes before the body is parsed or any field is believed.
 *
 * Status codes are chosen for Razorpay's retry behaviour: anything we have
 * decided about (confirmed, replayed, ignored, flagged for refund) is a 200 so
 * it stops retrying; only a transient failure (500/503) asks for a retry.
 */
export const razorpayWebhook = onRequest(
  { region: REGION, maxInstances: 10, secrets: [RAZORPAY_WEBHOOK_SECRET] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.set('Allow', 'POST')
        res.status(405).send('Method not allowed')
        return
      }

      const secret = secretValue(RAZORPAY_WEBHOOK_SECRET).trim()
      if (!secret) {
        logger.error('Razorpay webhook secret is not configured.')
        res.status(503).send('Not configured')
        return
      }

      const rawBody = req.rawBody
      if (!rawBody?.length) {
        res.status(400).send('Empty body')
        return
      }

      if (!verifyWebhookSignature(rawBody, req.get('x-razorpay-signature'), secret)) {
        logger.warn('Razorpay webhook rejected: bad signature')
        res.status(401).send('Invalid signature')
        return
      }

      let payload: unknown
      try {
        payload = JSON.parse(rawBody.toString('utf8'))
      } catch {
        res.status(400).send('Invalid JSON')
        return
      }

      const payment = extractPaymentEntity(payload)
      if (!payment) {
        logger.info('Razorpay webhook ignored: unsupported or unrelated event')
        res.status(200).json({ status: 'ignored' })
        return
      }
      if (payment.status !== 'captured') {
        logger.info(`Razorpay payment ${payment.paymentId} ignored: status ${payment.status}`)
        res.status(200).json({ status: 'ignored' })
        return
      }
      if (!DOC_ID.test(payment.registrationId)) {
        logger.error(`Razorpay payment ${payment.paymentId} has a malformed registration id`)
        res.status(200).json({ status: 'ignored' })
        return
      }

      const outcome = await applyCapturedPayment(payment)
      logger.info(
        `Razorpay payment ${payment.paymentId} for ${payment.registrationId}: ${outcome}`,
      )
      res.status(200).json({ status: outcome })
    } catch (error) {
      // Unexpected (usually Firestore) failure with money possibly taken:
      // ask Razorpay to retry rather than lose the payment.
      logger.error('Razorpay webhook failed', error)
      if (!res.headersSent) res.status(500).send('Internal error')
    }
  },
)
