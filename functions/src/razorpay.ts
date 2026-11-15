import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Razorpay helpers — pure and dependency-free.
 *
 * Nothing in here touches the network, Firestore or a secret: callers pass the
 * secret in. That keeps every money-handling decision unit-testable without a
 * Razorpay account (see tests/razorpay.unit.test.ts) and keeps the file free of
 * firebase-functions types so the root test tsconfig can import it.
 */

export const CURRENCY = 'INR'

/** Razorpay rejects orders under ₹1. */
export const MIN_ORDER_PAISE = 100

/* -------------------------------------------------------------------------- */
/*                                   Amounts                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rupees → paise as an exact integer.
 *
 * Throws rather than guessing: a price of 99.999 or NaN must never turn into a
 * charge. `Math.round(rupees * 100)` is only safe once we know the input has at
 * most two decimals, because 19.99 * 100 is 1998.9999999999998 in floating
 * point and the rounding absorbs exactly that error and nothing larger.
 */
export function toPaise(rupees: number): number {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    throw new RangeError('Amount must be a finite number.')
  }
  if (rupees < 0) throw new RangeError('Amount cannot be negative.')

  const scaled = rupees * 100
  const paise = Math.round(scaled)
  if (Math.abs(scaled - paise) > 1e-6) {
    throw new RangeError('Amount cannot have more than two decimal places.')
  }
  if (!Number.isSafeInteger(paise)) throw new RangeError('Amount is too large.')
  return paise
}

/* -------------------------------------------------------------------------- */
/*                                 Signatures                                 */
/* -------------------------------------------------------------------------- */

/**
 * Constant-time check of a hex HMAC-SHA256 signature. Never throws: anything
 * that is not a 64 character hex string is simply "not valid".
 */
function hmacMatches(message: string | Buffer, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !secret) return false
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false

  const expected = createHmac('sha256', secret).update(message).digest()
  const received = Buffer.from(signature, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/**
 * Webhook authenticity: HMAC-SHA256 (hex) of the RAW request body with the
 * webhook secret, compared with the `X-Razorpay-Signature` header. It has to be
 * the bytes Razorpay sent — re-serialising parsed JSON changes whitespace and
 * key order and breaks the signature.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) return false
  return hmacMatches(rawBody, signature, secret)
}

/**
 * Checkout callback authenticity: HMAC-SHA256 (hex) of `order_id|payment_id`
 * with the API key secret.
 */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!orderId || !paymentId) return false
  return hmacMatches(`${orderId}|${paymentId}`, signature, secret)
}

/* -------------------------------------------------------------------------- */
/*                         Payment ↔ registration checks                      */
/* -------------------------------------------------------------------------- */

export interface PaymentFacts {
  /** Paise, as reported by Razorpay. */
  amount: number
  currency: string
  orderId: string
}

/** The slice of a registration document these checks look at. */
export interface RegistrationLike {
  registrationStatus?: string
  paymentStatus?: string
  razorpayOrderId?: string
}

/** The slice of an event document these checks look at (price is in rupees). */
export interface EventLike {
  price?: number
}

export type PaymentMismatch =
  | 'already_paid'
  | 'registration_cancelled'
  | 'registration_not_pending'
  | 'invalid_event_price'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'order_mismatch'

/**
 * Why a captured payment must NOT confirm this registration, or null when it
 * may. The expected amount comes from the EVENT as re-read on the server — never
 * from the payment payload, the registration copy or anything the client sent.
 */
export function paymentMismatchReason(
  payment: PaymentFacts,
  registration: RegistrationLike | null | undefined,
  event: EventLike | null | undefined,
): PaymentMismatch | null {
  if (!registration) return 'registration_not_pending'

  if (registration.paymentStatus === 'paid') return 'already_paid'
  if (registration.registrationStatus === 'cancelled') return 'registration_cancelled'
  if (
    registration.registrationStatus !== 'pending_payment' ||
    registration.paymentStatus !== 'pending'
  ) {
    return 'registration_not_pending'
  }

  let expected: number
  try {
    expected = toPaise(event?.price as number)
  } catch {
    return 'invalid_event_price'
  }
  if (expected < MIN_ORDER_PAISE) return 'invalid_event_price'

  if (!Number.isInteger(payment.amount) || payment.amount !== expected) return 'amount_mismatch'
  if (payment.currency !== CURRENCY) return 'currency_mismatch'

  if (
    typeof registration.razorpayOrderId !== 'string' ||
    !registration.razorpayOrderId ||
    registration.razorpayOrderId !== payment.orderId
  ) {
    return 'order_mismatch'
  }

  return null
}

export function paymentMatchesRegistration(
  payment: PaymentFacts,
  registration: RegistrationLike | null | undefined,
  event: EventLike | null | undefined,
): boolean {
  return paymentMismatchReason(payment, registration, event) === null
}

/* -------------------------------------------------------------------------- */
/*                               Webhook payloads                             */
/* -------------------------------------------------------------------------- */

export const SUPPORTED_WEBHOOK_EVENTS = ['payment.captured', 'order.paid'] as const

export interface PaymentEntity {
  event: (typeof SUPPORTED_WEBHOOK_EVENTS)[number]
  paymentId: string
  orderId: string
  /** Paise. */
  amount: number
  currency: string
  status: string
  registrationId: string
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Normalise a webhook payload into the one shape the handler cares about.
 *
 * Returns null for events we do not act on and for anything malformed. A
 * payment with no `notes.registrationId` is also null: it was not created by
 * our order flow, so there is nothing for us to confirm.
 *
 * Razorpay sends `notes` as `[]` when there are none, hence the object check.
 */
export function extractPaymentEntity(payload: unknown): PaymentEntity | null {
  const root = asObject(payload)
  if (!root) return null

  const event = root.event
  if (event !== 'payment.captured' && event !== 'order.paid') return null

  const inner = asObject(root.payload)
  const payment = asObject(asObject(inner?.payment)?.entity)
  if (!payment) return null

  const order = asObject(asObject(inner?.order)?.entity)

  const paymentId = nonEmptyString(payment.id)
  const orderId = nonEmptyString(payment.order_id) ?? nonEmptyString(order?.id)
  const currency = nonEmptyString(payment.currency)
  const status = nonEmptyString(payment.status)
  const amount = payment.amount
  if (!paymentId || !orderId || !currency || !status) return null
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null

  const registrationId =
    nonEmptyString(asObject(payment.notes)?.registrationId) ??
    nonEmptyString(asObject(order?.notes)?.registrationId)
  if (!registrationId) return null

  return { event, paymentId, orderId, amount, currency, status, registrationId }
}
