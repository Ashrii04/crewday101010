import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  extractPaymentEntity,
  paymentMatchesRegistration,
  paymentMismatchReason,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../functions/src/razorpay'

/**
 * Pure unit tests for the Razorpay helpers. Expected signatures are computed
 * here with node:crypto using Razorpay's documented algorithm (HMAC-SHA256,
 * hex digest), independently of the code under test. The secrets are made up.
 */

const SECRET = 'test-webhook-secret'
const hmac = (message: string | Buffer, secret = SECRET) =>
  createHmac('sha256', secret).update(message).digest('hex')

describe('toPaise', () => {
  it('converts whole and fractional rupees exactly', () => {
    expect(toPaise(0)).toBe(0)
    expect(toPaise(1)).toBe(100)
    expect(toPaise(499)).toBe(49900)
    expect(toPaise(0.5)).toBe(50)
    expect(toPaise(0.01)).toBe(1)
  })

  it('does not drift on classic float traps', () => {
    expect(toPaise(19.99)).toBe(1999)
    expect(toPaise(0.07)).toBe(7)
    expect(toPaise(1.1)).toBe(110)
    expect(toPaise(4.35)).toBe(435)
    expect(toPaise(1234567.89)).toBe(123456789)
  })

  it('always returns an integer', () => {
    for (const rupees of [0.29, 8.2, 33.33, 100.1, 999.99]) {
      expect(Number.isInteger(toPaise(rupees))).toBe(true)
    }
  })

  it('rejects NaN, infinities and non-numbers', () => {
    expect(() => toPaise(NaN)).toThrow(RangeError)
    expect(() => toPaise(Infinity)).toThrow(RangeError)
    expect(() => toPaise(-Infinity)).toThrow(RangeError)
    expect(() => toPaise('100' as unknown as number)).toThrow(RangeError)
    expect(() => toPaise(undefined as unknown as number)).toThrow(RangeError)
    expect(() => toPaise(null as unknown as number)).toThrow(RangeError)
  })

  it('rejects negative amounts', () => {
    expect(() => toPaise(-1)).toThrow(RangeError)
    expect(() => toPaise(-0.01)).toThrow(RangeError)
  })

  it('rejects more than two decimal places', () => {
    expect(() => toPaise(10.001)).toThrow(RangeError)
    expect(() => toPaise(99.999)).toThrow(RangeError)
    expect(() => toPaise(0.005)).toThrow(RangeError)
  })

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => toPaise(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
    expect(() => toPaise(1e300)).toThrow(RangeError)
  })
})

describe('verifyWebhookSignature', () => {
  const body = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1"}}}}'

  it('accepts the correct signature of the raw body', () => {
    expect(verifyWebhookSignature(body, hmac(body), SECRET)).toBe(true)
  })

  it('accepts a Buffer body and uppercase hex', () => {
    expect(verifyWebhookSignature(Buffer.from(body), hmac(body), SECRET)).toBe(true)
    expect(verifyWebhookSignature(body, hmac(body).toUpperCase(), SECRET)).toBe(true)
  })

  it('signs the exact bytes, including non-ASCII characters', () => {
    const unicode = '{"notes":{"name":"Zoë ₹499"}}'
    expect(verifyWebhookSignature(Buffer.from(unicode, 'utf8'), hmac(unicode), SECRET)).toBe(true)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyWebhookSignature(body, hmac(body, 'another-secret'), SECRET)).toBe(false)
  })

  it('rejects a tampered body, even by one character or whitespace', () => {
    const signature = hmac(body)
    expect(verifyWebhookSignature(body.replace('pay_1', 'pay_2'), signature, SECRET)).toBe(false)
    expect(verifyWebhookSignature(`${body} `, signature, SECRET)).toBe(false)
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 2), signature, SECRET)).toBe(false)
  })

  it('rejects a missing or empty signature without throwing', () => {
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, '', SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, null as unknown as string, SECRET)).toBe(false)
  })

  it('rejects wrong-length, odd-length and non-hex signatures without throwing', () => {
    const signature = hmac(body)
    expect(verifyWebhookSignature(body, signature.slice(0, 62), SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, signature.slice(0, 63), SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, `${signature}00`, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, 'z'.repeat(64), SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, `${signature.slice(0, 63)}g`, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, 'not a signature', SECRET)).toBe(false)
  })

  it('rejects when the secret is empty, even if the signature matches an empty key', () => {
    expect(verifyWebhookSignature(body, hmac(body, ''), '')).toBe(false)
  })

  it('rejects a body that is neither a string nor a Buffer', () => {
    expect(verifyWebhookSignature({} as unknown as string, hmac('{}'), SECRET)).toBe(false)
    expect(verifyWebhookSignature(undefined as unknown as string, hmac(''), SECRET)).toBe(false)
  })
})

describe('verifyCheckoutSignature', () => {
  const orderId = 'order_ABC123'
  const paymentId = 'pay_XYZ789'
  const signature = hmac(`${orderId}|${paymentId}`)

  it('accepts HMAC-SHA256 of order_id|payment_id', () => {
    expect(verifyCheckoutSignature(orderId, paymentId, signature, SECRET)).toBe(true)
  })

  it('rejects swapped, altered or foreign ids', () => {
    expect(verifyCheckoutSignature(paymentId, orderId, signature, SECRET)).toBe(false)
    expect(verifyCheckoutSignature(orderId, 'pay_other', signature, SECRET)).toBe(false)
    expect(verifyCheckoutSignature('order_other', paymentId, signature, SECRET)).toBe(false)
  })

  it('rejects a wrong secret, a malformed signature and missing ids', () => {
    expect(verifyCheckoutSignature(orderId, paymentId, signature, 'other')).toBe(false)
    expect(verifyCheckoutSignature(orderId, paymentId, undefined, SECRET)).toBe(false)
    expect(verifyCheckoutSignature(orderId, paymentId, 'abc', SECRET)).toBe(false)
    expect(verifyCheckoutSignature('', paymentId, hmac(`|${paymentId}`), SECRET)).toBe(false)
    expect(verifyCheckoutSignature(orderId, '', hmac(`${orderId}|`), SECRET)).toBe(false)
  })
})

describe('paymentMatchesRegistration', () => {
  const event = { price: 499 }
  const payment = { amount: 49900, currency: 'INR', orderId: 'order_1' }
  const pending = {
    registrationStatus: 'pending_payment',
    paymentStatus: 'pending',
    razorpayOrderId: 'order_1',
  }

  it('accepts a pending registration paid exactly in full against its order', () => {
    expect(paymentMatchesRegistration(payment, pending, event)).toBe(true)
    expect(paymentMismatchReason(payment, pending, event)).toBeNull()
  })

  it('accepts fractional prices without drift', () => {
    expect(paymentMatchesRegistration({ ...payment, amount: 1999 }, pending, { price: 19.99 })).toBe(true)
  })

  it('rejects a wrong amount (under, over, or a rupee figure)', () => {
    expect(paymentMismatchReason({ ...payment, amount: 49899 }, pending, event)).toBe('amount_mismatch')
    expect(paymentMismatchReason({ ...payment, amount: 49901 }, pending, event)).toBe('amount_mismatch')
    expect(paymentMismatchReason({ ...payment, amount: 499 }, pending, event)).toBe('amount_mismatch')
    expect(paymentMismatchReason({ ...payment, amount: 49900.5 }, pending, event)).toBe('amount_mismatch')
    expect(paymentMismatchReason({ ...payment, amount: NaN }, pending, event)).toBe('amount_mismatch')
  })

  it('judges the amount by the event price, not by what the registration says', () => {
    const stale = { ...pending, price: 1 }
    expect(paymentMismatchReason({ ...payment, amount: 100 }, stale, event)).toBe('amount_mismatch')
    expect(paymentMismatchReason(payment, stale, { price: 999 })).toBe('amount_mismatch')
  })

  it('rejects a wrong currency', () => {
    expect(paymentMismatchReason({ ...payment, currency: 'USD' }, pending, event)).toBe('currency_mismatch')
    expect(paymentMismatchReason({ ...payment, currency: 'inr' }, pending, event)).toBe('currency_mismatch')
    expect(paymentMismatchReason({ ...payment, currency: '' }, pending, event)).toBe('currency_mismatch')
  })

  it('rejects an order id that is not the one stored on the registration', () => {
    expect(paymentMismatchReason({ ...payment, orderId: 'order_2' }, pending, event)).toBe('order_mismatch')
    expect(paymentMismatchReason({ ...payment, orderId: '' }, pending, event)).toBe('order_mismatch')
  })

  it('rejects a registration that has no order id yet', () => {
    const { razorpayOrderId: _unused, ...withoutOrder } = pending
    void _unused
    expect(paymentMismatchReason(payment, withoutOrder, event)).toBe('order_mismatch')
    expect(paymentMismatchReason({ ...payment, orderId: '' }, { ...pending, razorpayOrderId: '' }, event)).toBe(
      'order_mismatch',
    )
  })

  it('rejects an already paid registration', () => {
    const paid = { ...pending, registrationStatus: 'confirmed', paymentStatus: 'paid' }
    expect(paymentMismatchReason(payment, paid, event)).toBe('already_paid')
    expect(paymentMatchesRegistration(payment, paid, event)).toBe(false)
  })

  it('rejects a cancelled registration, whatever its payment status', () => {
    expect(
      paymentMismatchReason(payment, { ...pending, registrationStatus: 'cancelled' }, event),
    ).toBe('registration_cancelled')
    expect(
      paymentMatchesRegistration(
        payment,
        { ...pending, registrationStatus: 'cancelled', paymentStatus: 'failed' },
        event,
      ),
    ).toBe(false)
  })

  it('rejects registrations that are not awaiting payment', () => {
    expect(
      paymentMismatchReason(payment, { ...pending, registrationStatus: 'confirmed', paymentStatus: 'not_required' }, event),
    ).toBe('registration_not_pending')
    expect(paymentMismatchReason(payment, { ...pending, registrationStatus: 'waitlisted' }, event)).toBe(
      'registration_not_pending',
    )
    expect(paymentMismatchReason(payment, { ...pending, paymentStatus: 'failed' }, event)).toBe(
      'registration_not_pending',
    )
  })

  it('rejects missing registration, fields or event without throwing', () => {
    expect(paymentMatchesRegistration(payment, null, event)).toBe(false)
    expect(paymentMatchesRegistration(payment, undefined, event)).toBe(false)
    expect(paymentMatchesRegistration(payment, {}, event)).toBe(false)
    expect(paymentMatchesRegistration(payment, pending, null)).toBe(false)
    expect(paymentMatchesRegistration(payment, pending, undefined)).toBe(false)
    expect(paymentMatchesRegistration(payment, pending, {})).toBe(false)
  })

  it('rejects unusable event prices', () => {
    for (const price of [0, -499, NaN, 10.001, 0.5]) {
      expect(paymentMismatchReason(payment, pending, { price })).toBe('invalid_event_price')
    }
    expect(paymentMismatchReason(payment, pending, { price: '499' as unknown as number })).toBe(
      'invalid_event_price',
    )
  })
})

describe('extractPaymentEntity', () => {
  const entity = {
    id: 'pay_1',
    order_id: 'order_1',
    amount: 49900,
    currency: 'INR',
    status: 'captured',
    notes: { registrationId: 'evt1__user1', eventId: 'evt1', userId: 'user1' },
  }
  const captured = { event: 'payment.captured', payload: { payment: { entity } } }
  const expected = {
    paymentId: 'pay_1',
    orderId: 'order_1',
    amount: 49900,
    currency: 'INR',
    status: 'captured',
    registrationId: 'evt1__user1',
  }

  it('normalises payment.captured', () => {
    expect(extractPaymentEntity(captured)).toEqual({ event: 'payment.captured', ...expected })
  })

  it('normalises order.paid, reading notes from the order when the payment has none', () => {
    const orderPaid = {
      event: 'order.paid',
      payload: {
        payment: { entity: { ...entity, notes: [] } },
        order: { entity: { id: 'order_1', amount: 49900, notes: entity.notes } },
      },
    }
    expect(extractPaymentEntity(orderPaid)).toEqual({ event: 'order.paid', ...expected })
    expect(
      extractPaymentEntity({ event: 'order.paid', payload: { payment: { entity }, order: { entity: { id: 'order_1' } } } }),
    ).toEqual({ event: 'order.paid', ...expected })
  })

  it('falls back to the order id on the order entity', () => {
    const { order_id: _unused, ...withoutOrderId } = entity
    void _unused
    const result = extractPaymentEntity({
      event: 'order.paid',
      payload: { payment: { entity: withoutOrderId }, order: { entity: { id: 'order_9' } } },
    })
    expect(result?.orderId).toBe('order_9')
  })

  it('passes the status through so the caller can refuse non-captured payments', () => {
    const failed = { event: 'payment.captured', payload: { payment: { entity: { ...entity, status: 'authorized' } } } }
    expect(extractPaymentEntity(failed)?.status).toBe('authorized')
  })

  it('returns null for unsupported events', () => {
    for (const event of ['payment.failed', 'payment.authorized', 'refund.created', 'order.created', '', 42]) {
      expect(extractPaymentEntity({ ...captured, event })).toBeNull()
    }
    expect(extractPaymentEntity({ payload: captured.payload })).toBeNull()
  })

  it('returns null for non-object payloads', () => {
    for (const value of [null, undefined, 'payment.captured', 7, true, [], [captured]]) {
      expect(extractPaymentEntity(value)).toBeNull()
    }
  })

  it('returns null when the payment entity is missing or malformed', () => {
    expect(extractPaymentEntity({ event: 'payment.captured' })).toBeNull()
    expect(extractPaymentEntity({ event: 'payment.captured', payload: {} })).toBeNull()
    expect(extractPaymentEntity({ event: 'payment.captured', payload: { payment: {} } })).toBeNull()
    expect(extractPaymentEntity({ event: 'payment.captured', payload: { payment: { entity: 'x' } } })).toBeNull()
  })

  it('returns null when a required field is missing or the wrong type', () => {
    const withEntity = (patch: Record<string, unknown>) => ({
      event: 'payment.captured',
      payload: { payment: { entity: { ...entity, ...patch } } },
    })
    expect(extractPaymentEntity(withEntity({ id: undefined }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ id: '' }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ order_id: undefined }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ currency: undefined }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ status: undefined }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ amount: '49900' }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ amount: 499.5 }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ amount: -1 }))).toBeNull()
    expect(extractPaymentEntity(withEntity({ amount: NaN }))).toBeNull()
  })

  it('returns null when there is no registration id in the notes', () => {
    const withNotes = (notes: unknown) => ({
      event: 'payment.captured',
      payload: { payment: { entity: { ...entity, notes } } },
    })
    expect(extractPaymentEntity(withNotes([]))).toBeNull()
    expect(extractPaymentEntity(withNotes({}))).toBeNull()
    expect(extractPaymentEntity(withNotes({ registrationId: '' }))).toBeNull()
    expect(extractPaymentEntity(withNotes({ registrationId: 123 }))).toBeNull()
    expect(extractPaymentEntity(withNotes(null))).toBeNull()
  })
})
