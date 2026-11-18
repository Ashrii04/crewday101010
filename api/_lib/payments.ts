/**
 * CrewDay — Razorpay online payments as Vercel API routes
 * ============================================================================
 *
 * The same server logic as functions/src/payments.ts (the dormant Cloud
 * Functions version, which needs the Blaze plan), moved to Vercel so it runs on
 * the free Firebase Spark plan. Every money decision is made by the pure
 * helpers in functions/src/razorpay.ts, imported here rather than copied.
 *
 * This file knows nothing about Vercel, environment variables or how
 * firebase-admin was initialised: the database, the Razorpay keys, the token
 * verifier and `fetch` are all passed in. That is what lets
 * tests/paymentsApi.*.test.ts drive it without a network or a Razorpay
 * account. api/_lib/runtime.ts wires in the real ones, and Vercel does not turn
 * `_`-prefixed files into routes.
 *
 * Flow:
 *   1. The member registers for a paid event; the client writes a registration
 *      with `pending_payment` / `pending`.
 *   2. `createOrderCore` creates a Razorpay order for the EVENT's price and
 *      stores the order id on the registration.
 *   3. After Checkout succeeds, Razorpay calls the webhook. Only that webhook —
 *      the Admin SDK, after verifying the signature and re-checking the amount —
 *      confirms the registration. The browser never does.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import {
  CURRENCY,
  MIN_ORDER_PAISE,
  extractPaymentEntity,
  paymentMismatchReason,
  toPaise,
  verifyWebhookSignature,
  type PaymentEntity,
  type PaymentMismatch,
} from '../../functions/src/razorpay.js'

const ORDERS_URL = 'https://api.razorpay.com/v1/orders'

/** Firestore auto ids and `eventId__uid` ids; also keeps a path out of the id. */
const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/

export const NOT_SET_UP_MESSAGE = 'Online payments are not set up yet'

/** An error that maps straight to an HTTP status and a message safe to show. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** Keys, secrets or Firebase credentials are missing: reply 503, never crash. */
export class NotConfiguredError extends Error {
  constructor(message = NOT_SET_UP_MESSAGE) {
    super(message)
    this.name = 'NotConfiguredError'
  }
}

/** A database, or a way to get one lazily (so a bad request never builds it). */
export type DbSource = Firestore | (() => Firestore)

function resolveDb(source: DbSource): Firestore {
  return typeof source === 'function' ? source() : source
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export function methodNotAllowed(_request?: Request): Response {
  return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
}

/* -------------------------------------------------------------------------- */
/*                               Create an order                              */
/* -------------------------------------------------------------------------- */

interface RazorpayOrderResponse {
  id?: unknown
  amount?: unknown
  currency?: unknown
}

export interface CreateOrderInput {
  db: DbSource
  /** Verified Firebase uid of the caller. */
  uid: string
  registrationId: string
  razorpay: { keyId: string; keySecret: string }
  fetchImpl?: typeof fetch
}

export interface CreatedOrder {
  orderId: string
  amount: number
  currency: string
  keyId: string
}

/**
 * Start a payment for the caller's own pending registration.
 *
 * The amount is derived here from the event document. The client sends only the
 * registration id, so there is no amount to tamper with.
 */
export async function createOrderCore(input: CreateOrderInput): Promise<CreatedOrder> {
  const { uid, registrationId, razorpay } = input
  const fetchImpl = input.fetchImpl ?? fetch

  if (!DOC_ID.test(registrationId)) throw new ApiError(400, 'A valid registration is required.')

  const db = resolveDb(input.db)
  const registrationRef = db.collection('registrations').doc(registrationId)
  const registrationSnapshot = await registrationRef.get()
  if (!registrationSnapshot.exists) throw new ApiError(404, 'Registration not found.')
  const registration = registrationSnapshot.data() ?? {}

  // Only the member who owns the seat may pay for it.
  if (registration.userId !== uid) throw new ApiError(403, 'This registration is not yours.')
  if (
    registration.registrationStatus !== 'pending_payment' ||
    registration.paymentStatus !== 'pending'
  ) {
    throw new ApiError(409, 'This registration is not awaiting payment.')
  }

  const eventId = registration.eventId
  if (typeof eventId !== 'string' || !DOC_ID.test(eventId)) {
    throw new ApiError(409, 'This registration has no valid event.')
  }
  const eventSnapshot = await db.collection('events').doc(eventId).get()
  if (!eventSnapshot.exists) throw new ApiError(404, 'This event no longer exists.')
  const event = eventSnapshot.data() ?? {}
  if (event.status !== 'open' && event.status !== 'closed') {
    throw new ApiError(409, 'This event is no longer taking payments.')
  }

  let amount: number
  try {
    amount = toPaise(event.price)
  } catch {
    console.error(`Event ${eventId} has an unusable price`)
    throw new ApiError(409, 'This event has no valid price.')
  }
  if (amount < MIN_ORDER_PAISE) {
    throw new ApiError(409, 'This event does not need an online payment.')
  }

  let response: Response
  try {
    response = await fetchImpl(ORDERS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${razorpay.keyId}:${razorpay.keySecret}`).toString('base64')}`,
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
  } catch {
    console.error(`Razorpay order request failed for registration ${registrationId}`)
    throw new ApiError(502, 'Could not reach the payment provider. Try again.')
  }

  if (!response.ok) {
    // The error body is Razorpay's own description; it contains no secrets.
    const detail = await response.text().catch(() => '')
    console.error(
      `Razorpay order creation returned ${response.status} for registration ${registrationId}`,
      detail.slice(0, 300),
    )
    throw new ApiError(502, 'Could not start the payment. Try again.')
  }

  const order = (await response.json().catch(() => ({}))) as RazorpayOrderResponse
  if (
    typeof order.id !== 'string' ||
    !order.id ||
    order.amount !== amount ||
    order.currency !== CURRENCY
  ) {
    console.error(`Razorpay returned an unexpected order for registration ${registrationId}`)
    throw new ApiError(502, 'Could not start the payment. Try again.')
  }

  // Last order wins. The webhook only confirms a payment made against the
  // order id stored here.
  await registrationRef.update({
    razorpayOrderId: order.id,
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.info(`Created Razorpay order ${order.id} for registration ${registrationId}`)
  return { orderId: order.id, amount, currency: CURRENCY, keyId: razorpay.keyId }
}

export interface OrderRouteDeps {
  /** The Razorpay API keys, or null when they are not configured. */
  razorpay: () => { keyId: string; keySecret: string } | null
  /** Resolves the Firebase uid for an ID token; rejects when it is invalid. */
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>
  getDb: () => Firestore
  fetchImpl?: typeof fetch
}

/**
 * POST /api/razorpay-order. Order of checks: method, configuration, bearer
 * token, body shape — and only then the database.
 */
export async function handleOrderRequest(request: Request, deps: OrderRouteDeps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  try {
    const keys = deps.razorpay()
    if (!keys) throw new NotConfiguredError()

    const idToken = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!idToken) throw new ApiError(401, 'Sign in to pay online.')

    let uid: string
    try {
      uid = (await deps.verifyIdToken(idToken)).uid
    } catch (error) {
      if (error instanceof NotConfiguredError) throw error
      throw new ApiError(401, 'Your session has expired. Sign in again.')
    }
    if (!uid) throw new ApiError(401, 'Your session has expired. Sign in again.')

    let registrationId: unknown
    try {
      registrationId = ((await request.json()) as { registrationId?: unknown } | null)?.registrationId
    } catch {
      throw new ApiError(400, 'A valid registration is required.')
    }
    if (typeof registrationId !== 'string' || !DOC_ID.test(registrationId)) {
      throw new ApiError(400, 'A valid registration is required.')
    }

    // Only `registrationId` is read from the body; any amount sent is ignored.
    const order = await createOrderCore({
      db: deps.getDb,
      uid,
      registrationId,
      razorpay: keys,
      fetchImpl: deps.fetchImpl,
    })
    return json(200, order)
  } catch (error) {
    return errorResponse(error, 'Razorpay order request failed')
  }
}

function errorResponse(error: unknown, logMessage: string): Response {
  if (error instanceof NotConfiguredError) {
    console.error('Online payments are not configured (Razorpay keys or Firebase credentials).')
    return json(503, { error: NOT_SET_UP_MESSAGE })
  }
  if (error instanceof ApiError) return json(error.status, { error: error.message })
  console.error(logMessage, error instanceof Error ? error.name : 'unknown error')
  return json(500, { error: 'Something went wrong. Try again.' })
}

/* -------------------------------------------------------------------------- */
/*                                   Webhook                                  */
/* -------------------------------------------------------------------------- */

export type WebhookOutcome =
  | 'confirmed'
  | 'already_processed'
  | 'unknown_registration'
  | 'flagged'
  | 'ignored'

export interface WebhookResult {
  status: number
  body: { status: WebhookOutcome } | { error: string }
}

/**
 * Apply one captured payment inside a transaction.
 *
 * Reads come first, then writes. A payment that cannot be confirmed is never
 * dropped silently: it is logged and written to `paymentIssues` (one document
 * per Razorpay payment id, so replays do not pile up) for a manual refund.
 */
async function applyCapturedPayment(db: Firestore, payment: PaymentEntity): Promise<WebhookOutcome> {
  const issueRef = db.collection('paymentIssues').doc(payment.paymentId)

  const flag = (
    transaction: Transaction,
    reason: PaymentMismatch | 'unknown_registration' | 'event_missing' | 'duplicate_payment',
    alreadyFlagged: boolean,
    context: { userId?: string; eventId?: string } = {},
  ): WebhookOutcome => {
    console.error(
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

export interface WebhookInput {
  db: DbSource
  /** The request body exactly as received. It is never re-serialised. */
  rawBody: string
  /** The `X-Razorpay-Signature` header. */
  signature: string | null | undefined
  webhookSecret: string
}

/**
 * Razorpay → us. Authenticity first: the signature is checked against the raw
 * bytes before the body is parsed or any field is believed, and nothing touches
 * the database until it passes.
 *
 * Status codes are chosen for Razorpay's retry behaviour: anything we have
 * decided about (confirmed, replayed, ignored, flagged for refund) is a 200 so
 * it stops retrying; only a transient failure (500/503) asks for a retry.
 */
export async function handleWebhookCore(input: WebhookInput): Promise<WebhookResult> {
  const { rawBody, signature, webhookSecret } = input

  if (!rawBody) return { status: 400, body: { error: 'Empty body' } }

  if (!verifyWebhookSignature(rawBody, signature ?? undefined, webhookSecret)) {
    console.warn('Razorpay webhook rejected: bad signature')
    return { status: 401, body: { error: 'Invalid signature' } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } }
  }

  const payment = extractPaymentEntity(payload)
  if (!payment) {
    console.info('Razorpay webhook ignored: unsupported or unrelated event')
    return { status: 200, body: { status: 'ignored' } }
  }
  if (payment.status !== 'captured') {
    console.info(`Razorpay payment ${payment.paymentId} ignored: status ${payment.status}`)
    return { status: 200, body: { status: 'ignored' } }
  }
  // Ids become document paths, so a malformed one can never be applied.
  if (!DOC_ID.test(payment.registrationId) || !DOC_ID.test(payment.paymentId)) {
    console.error(`Razorpay payment ${payment.paymentId} has a malformed id`)
    return { status: 200, body: { status: 'ignored' } }
  }

  try {
    const outcome = await applyCapturedPayment(resolveDb(input.db), payment)
    console.info(`Razorpay payment ${payment.paymentId} for ${payment.registrationId}: ${outcome}`)
    return { status: 200, body: { status: outcome } }
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      console.error('Online payments are not configured (Firebase credentials).')
      return { status: 503, body: { error: NOT_SET_UP_MESSAGE } }
    }
    // Unexpected (usually Firestore) failure with money possibly taken: ask
    // Razorpay to retry rather than lose the payment.
    console.error(
      `Razorpay webhook failed for payment ${payment.paymentId}`,
      error instanceof Error ? error.name : 'unknown error',
    )
    return { status: 500, body: { error: 'Internal error' } }
  }
}

export interface WebhookRouteDeps {
  /** The webhook secret, or null when it is not configured. */
  webhookSecret: () => string | null
  getDb: () => Firestore
}

/** POST /api/razorpay-webhook. */
export async function handleWebhookRequest(
  request: Request,
  deps: WebhookRouteDeps,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()

  const webhookSecret = deps.webhookSecret()
  if (!webhookSecret) {
    console.error('Razorpay webhook secret is not configured.')
    return json(503, { error: NOT_SET_UP_MESSAGE })
  }

  // The RAW text, read before anything parses it: the signature covers these
  // exact bytes and a re-serialised body would not match.
  const rawBody = await request.text().catch(() => '')

  const result = await handleWebhookCore({
    db: deps.getDb,
    rawBody,
    signature: request.headers.get('x-razorpay-signature'),
    webhookSecret,
  })
  return json(result.status, result.body)
}
