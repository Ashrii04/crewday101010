/**
 * The payment routes' Firestore logic, against the emulator, through the Admin
 * SDK (which is what the real routes use, and which bypasses security rules —
 * the rules themselves are covered by services.rules.test.ts).
 *
 *   npx firebase emulators:exec --only firestore "npx vitest run --project rules"
 */

import { createHmac } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createOrderCore,
  handleOrderRequest,
  handleWebhookCore,
  handleWebhookRequest,
} from '../api/_lib/payments'

// `firebase emulators:exec` exports FIRESTORE_EMULATOR_HOST, so the suite follows
// whichever port the emulator actually got; 8080 is only the default. The Admin
// SDK reads the same variable itself.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
const [emulatorHost, emulatorPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'crewday-rules-test'

const WEBHOOK_SECRET = 'test-webhook-secret'
const RAZORPAY = { keyId: 'rzp_test_public', keySecret: 'test-key-secret' }
const MEMBER = 'member-uid'
const OTHER = 'other-uid'
const EVENT_ID = 'event-1'
const REGISTRATION_ID = `${EVENT_ID}__${MEMBER}`

let db: Firestore

beforeAll(() => {
  const app = getApps().find((a) => a.name === 'payments-test') ?? initializeApp({ projectId: PROJECT_ID }, 'payments-test')
  db = getFirestore(app)
})

beforeEach(async () => {
  const response = await fetch(
    `http://${emulatorHost}:${emulatorPort}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
  expect(response.ok).toBe(true)
})

async function seed(
  registration: Record<string, unknown> | null = {},
  event: Record<string, unknown> | null = {},
) {
  if (event) {
    await db.collection('events').doc(EVENT_ID).set({ title: 'Jam', status: 'open', price: 199, ...event })
  }
  if (registration) {
    const data: Record<string, unknown> = {
      userId: MEMBER,
      eventId: EVENT_ID,
      registrationStatus: 'pending_payment',
      paymentStatus: 'pending',
      razorpayOrderId: 'order_1',
      ...registration,
    }
    // `{ razorpayOrderId: undefined }` in a test means "this field is absent".
    for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key]
    await db.collection('registrations').doc(REGISTRATION_ID).set(data)
  }
}

const registrationData = async () => (await db.collection('registrations').doc(REGISTRATION_ID).get()).data()
const issue = async (paymentId: string) => (await db.collection('paymentIssues').doc(paymentId).get()).data()

/* --------------------------------- webhook -------------------------------- */

function webhookBody(overrides: Record<string, unknown> = {}, event = 'payment.captured') {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: 'pay_1',
          order_id: 'order_1',
          amount: 19900,
          currency: 'INR',
          status: 'captured',
          notes: { registrationId: REGISTRATION_ID },
          ...overrides,
        },
      },
    },
  })
}

const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')

function deliver(body: string) {
  return handleWebhookCore({ db, rawBody: body, signature: sign(body), webhookSecret: WEBHOOK_SECRET })
}

describe('webhook: handleWebhookCore', () => {
  it('confirms a payment that matches the registration, event price and order', async () => {
    await seed()

    expect(await deliver(webhookBody())).toEqual({ status: 200, body: { status: 'confirmed' } })

    const registration = await registrationData()
    expect(registration).toMatchObject({
      paymentStatus: 'paid',
      registrationStatus: 'confirmed',
      paymentMethod: 'razorpay',
      paymentReference: 'pay_1',
      razorpayPaymentId: 'pay_1',
    })
    expect(registration?.paidAt).toBeDefined()
    expect(registration?.updatedAt).toBeDefined()
    expect(await issue('pay_1')).toBeUndefined()
  })

  it('also confirms on order.paid', async () => {
    await seed()
    expect((await deliver(webhookBody({}, 'order.paid'))).body).toEqual({ status: 'confirmed' })
    expect((await registrationData())?.paymentStatus).toBe('paid')
  })

  it('treats a replay of the same payment as a 200 no-op', async () => {
    await seed()
    await deliver(webhookBody())
    const first = await registrationData()

    expect(await deliver(webhookBody())).toEqual({ status: 200, body: { status: 'already_processed' } })

    const second = await registrationData()
    expect(second?.paidAt.isEqual(first?.paidAt)).toBe(true)
    expect(second?.updatedAt.isEqual(first?.updatedAt)).toBe(true)
    expect(await issue('pay_1')).toBeUndefined()
  })

  it('flags an amount mismatch and does not confirm', async () => {
    await seed()

    expect(await deliver(webhookBody({ amount: 100 }))).toEqual({ status: 200, body: { status: 'flagged' } })

    expect(await registrationData()).toMatchObject({
      paymentStatus: 'pending',
      registrationStatus: 'pending_payment',
    })
    expect(await issue('pay_1')).toMatchObject({
      reason: 'amount_mismatch',
      registrationId: REGISTRATION_ID,
      razorpayPaymentId: 'pay_1',
      razorpayOrderId: 'order_1',
      amount: 100,
      currency: 'INR',
      userId: MEMBER,
      eventId: EVENT_ID,
      resolved: false,
    })
  })

  it('takes the expected amount from the event, so a later price change is a mismatch', async () => {
    await seed({}, { price: 250 })
    expect((await deliver(webhookBody())).body).toEqual({ status: 'flagged' })
    expect((await issue('pay_1'))?.reason).toBe('amount_mismatch')
    expect((await registrationData())?.paymentStatus).toBe('pending')
  })

  it('flags a currency mismatch', async () => {
    await seed()
    await deliver(webhookBody({ currency: 'USD' }))
    expect((await issue('pay_1'))?.reason).toBe('currency_mismatch')
    expect((await registrationData())?.paymentStatus).toBe('pending')
  })

  it('flags a payment made against a different order id', async () => {
    await seed()
    await deliver(webhookBody({ order_id: 'order_OLD' }))
    expect((await issue('pay_1'))?.reason).toBe('order_mismatch')
    expect((await registrationData())?.paymentStatus).toBe('pending')
  })

  it('flags a payment for a registration with no recorded order', async () => {
    await seed({ razorpayOrderId: undefined })
    await deliver(webhookBody())
    expect((await issue('pay_1'))?.reason).toBe('order_mismatch')
  })

  it('flags a payment for a cancelled registration', async () => {
    await seed({ registrationStatus: 'cancelled' })
    expect((await deliver(webhookBody())).body).toEqual({ status: 'flagged' })
    expect((await issue('pay_1'))?.reason).toBe('registration_cancelled')
    expect(await registrationData()).toMatchObject({
      registrationStatus: 'cancelled',
      paymentStatus: 'pending',
    })
  })

  it('flags a second payment for an already-paid registration as a duplicate', async () => {
    await seed({ registrationStatus: 'confirmed', paymentStatus: 'paid', razorpayPaymentId: 'pay_OTHER' })

    expect((await deliver(webhookBody())).body).toEqual({ status: 'flagged' })

    expect((await issue('pay_1'))?.reason).toBe('duplicate_payment')
    expect((await registrationData())?.razorpayPaymentId).toBe('pay_OTHER')
  })

  it('flags a payment whose event is gone', async () => {
    await seed({}, null)
    expect((await deliver(webhookBody())).body).toEqual({ status: 'flagged' })
    expect((await issue('pay_1'))?.reason).toBe('event_missing')
    expect((await registrationData())?.paymentStatus).toBe('pending')
  })

  it('acknowledges (200) and records a payment for an unknown registration', async () => {
    await seed(null)
    expect(await deliver(webhookBody())).toEqual({
      status: 200,
      body: { status: 'unknown_registration' },
    })
    expect(await issue('pay_1')).toMatchObject({
      reason: 'unknown_registration',
      registrationId: REGISTRATION_ID,
      userId: '',
      eventId: '',
    })
  })

  it('does not pile up issue documents when a flagged payment is replayed', async () => {
    await seed()
    await deliver(webhookBody({ amount: 100 }))
    const first = await issue('pay_1')

    await deliver(webhookBody({ amount: 100 }))

    const issues = await db.collection('paymentIssues').get()
    expect(issues.size).toBe(1)
    expect((await issue('pay_1'))?.createdAt.isEqual(first?.createdAt)).toBe(true)
  })

  it('ignores a payment that is not captured', async () => {
    await seed()
    expect((await deliver(webhookBody({ status: 'failed' }))).body).toEqual({ status: 'ignored' })
    expect((await registrationData())?.paymentStatus).toBe('pending')
    expect((await db.collection('paymentIssues').get()).size).toBe(0)
  })

  it('never writes for a bad signature', async () => {
    await seed()
    const body = webhookBody()
    const result = await handleWebhookCore({
      db,
      rawBody: body,
      signature: sign(`${body} `),
      webhookSecret: WEBHOOK_SECRET,
    })
    expect(result.status).toBe(401)
    expect((await registrationData())?.paymentStatus).toBe('pending')
  })

  it('confirms only once when the same payment is delivered concurrently', async () => {
    await seed()
    const results = await Promise.all([deliver(webhookBody()), deliver(webhookBody()), deliver(webhookBody())])
    const outcomes = results.map((r) => ('status' in r.body ? r.body.status : ''))
    expect(outcomes.filter((o) => o === 'confirmed')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'already_processed')).toHaveLength(2)
    expect((await db.collection('paymentIssues').get()).size).toBe(0)
  })

  it('works end to end through the request handler', async () => {
    await seed()
    const body = webhookBody()
    const response = await handleWebhookRequest(
      new Request('https://example.test/api/razorpay-webhook', {
        method: 'POST',
        headers: { 'X-Razorpay-Signature': sign(body) },
        body,
      }),
      { webhookSecret: () => WEBHOOK_SECRET, getDb: () => db },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'confirmed' })
    expect((await registrationData())?.paymentStatus).toBe('paid')
  })
})

/* ------------------------------- create order ------------------------------ */

function fakeRazorpay(reply: (sent: { amount: number }) => Record<string, unknown> = ({ amount }) => ({
  id: 'order_NEW',
  amount,
  currency: 'INR',
})) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    Response.json(reply(JSON.parse(init?.body as string))),
  )
}

const asFetch = (mock: ReturnType<typeof fakeRazorpay>) => mock as unknown as typeof fetch

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('order: createOrderCore', () => {
  it('creates an order for the event price in paise and stores the order id', async () => {
    await seed({ razorpayOrderId: undefined }, { price: 249.5 })
    const razorpay = fakeRazorpay()

    const order = await createOrderCore({
      db,
      uid: MEMBER,
      registrationId: REGISTRATION_ID,
      razorpay: RAZORPAY,
      fetchImpl: asFetch(razorpay),
    })

    expect(order).toEqual({
      orderId: 'order_NEW',
      amount: 24950,
      currency: 'INR',
      keyId: RAZORPAY.keyId,
    })

    expect(razorpay).toHaveBeenCalledTimes(1)
    const [url, init] = razorpay.mock.calls[0]
    expect(url).toBe('https://api.razorpay.com/v1/orders')
    expect(init?.method).toBe('POST')
    const sent = JSON.parse(init?.body as string)
    expect(sent).toMatchObject({
      amount: 24950,
      currency: 'INR',
      notes: { registrationId: REGISTRATION_ID, eventId: EVENT_ID, userId: MEMBER },
    })
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString('base64')}`,
    )

    const registration = await registrationData()
    expect(registration?.razorpayOrderId).toBe('order_NEW')
    // Creating an order must not change what has been paid.
    expect(registration).toMatchObject({ registrationStatus: 'pending_payment', paymentStatus: 'pending' })
  })

  it('lets the latest order replace an earlier one', async () => {
    await seed({ razorpayOrderId: 'order_OLD' })
    await createOrderCore({
      db,
      uid: MEMBER,
      registrationId: REGISTRATION_ID,
      razorpay: RAZORPAY,
      fetchImpl: asFetch(fakeRazorpay()),
    })
    expect((await registrationData())?.razorpayOrderId).toBe('order_NEW')
  })

  it('rejects someone who does not own the registration, without calling Razorpay', async () => {
    await seed()
    const razorpay = fakeRazorpay()
    const error = await rejection(
      createOrderCore({
        db,
        uid: OTHER,
        registrationId: REGISTRATION_ID,
        razorpay: RAZORPAY,
        fetchImpl: asFetch(razorpay),
      }),
    )
    expect(error.status).toBe(403)
    expect(razorpay).not.toHaveBeenCalled()
    expect((await registrationData())?.razorpayOrderId).toBe('order_1')
  })

  it.each([
    ['already paid', { registrationStatus: 'confirmed', paymentStatus: 'paid' }],
    ['cancelled', { registrationStatus: 'cancelled' }],
    ['free', { registrationStatus: 'confirmed', paymentStatus: 'not_required' }],
  ])('rejects a registration that is %s', async (_label, state) => {
    await seed(state)
    const razorpay = fakeRazorpay()
    const error = await rejection(
      createOrderCore({
        db,
        uid: MEMBER,
        registrationId: REGISTRATION_ID,
        razorpay: RAZORPAY,
        fetchImpl: asFetch(razorpay),
      }),
    )
    expect(error.status).toBe(409)
    expect(razorpay).not.toHaveBeenCalled()
  })

  it('rejects an unknown registration, a missing event and an event not taking payments', async () => {
    const run = () =>
      rejection(
        createOrderCore({
          db,
          uid: MEMBER,
          registrationId: REGISTRATION_ID,
          razorpay: RAZORPAY,
          fetchImpl: asFetch(fakeRazorpay()),
        }),
      )

    await seed(null, null)
    expect((await run()).status).toBe(404)

    await seed({}, null)
    expect((await run()).status).toBe(404)

    await seed({}, { status: 'cancelled' })
    expect((await run()).status).toBe(409)
  })

  it.each([0, -5, 0.5, 12.345, 'free'])('rejects an event price that cannot be charged (%s)', async (price) => {
    await seed({}, { price })
    const razorpay = fakeRazorpay()
    const error = await rejection(
      createOrderCore({
        db,
        uid: MEMBER,
        registrationId: REGISTRATION_ID,
        razorpay: RAZORPAY,
        fetchImpl: asFetch(razorpay),
      }),
    )
    expect(error.status).toBe(409)
    expect(razorpay).not.toHaveBeenCalled()
  })

  it.each([
    ['a different amount', { id: 'order_NEW', amount: 100, currency: 'INR' }],
    ['a different currency', { id: 'order_NEW', amount: 19900, currency: 'USD' }],
    ['no order id', { amount: 19900, currency: 'INR' }],
  ])('rejects a Razorpay reply that has %s, and stores no order id', async (_label, reply) => {
    await seed({ razorpayOrderId: undefined })
    const error = await rejection(
      createOrderCore({
        db,
        uid: MEMBER,
        registrationId: REGISTRATION_ID,
        razorpay: RAZORPAY,
        fetchImpl: asFetch(fakeRazorpay(() => reply)),
      }),
    )
    expect(error.status).toBe(502)
    expect((await registrationData())?.razorpayOrderId).toBeUndefined()
  })

  it('reports a failing or unreachable Razorpay as 502 without leaking its reply', async () => {
    await seed({ razorpayOrderId: undefined })
    const failing = vi.fn(async () => new Response('key secret-detail rejected', { status: 401 }))
    const down = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED')
    })
    for (const impl of [failing, down]) {
      const error = await rejection(
        createOrderCore({
          db,
          uid: MEMBER,
          registrationId: REGISTRATION_ID,
          razorpay: RAZORPAY,
          fetchImpl: impl as unknown as typeof fetch,
        }),
      )
      expect(error.status).toBe(502)
      expect(error.message).not.toMatch(/secret-detail|ECONNREFUSED/)
    }
    expect((await registrationData())?.razorpayOrderId).toBeUndefined()
  })

  it('ignores any amount the client sends and prices from the event', async () => {
    await seed({ razorpayOrderId: undefined })
    const razorpay = fakeRazorpay()

    const response = await handleOrderRequest(
      new Request('https://example.test/api/razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good-token' },
        body: JSON.stringify({ registrationId: REGISTRATION_ID, amount: 1, price: 0.01, currency: 'USD' }),
      }),
      {
        razorpay: () => RAZORPAY,
        verifyIdToken: async () => ({ uid: MEMBER }),
        getDb: () => db,
        fetchImpl: asFetch(razorpay),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      orderId: 'order_NEW',
      amount: 19900,
      currency: 'INR',
      keyId: RAZORPAY.keyId,
    })
    expect(JSON.parse(razorpay.mock.calls[0][1]?.body as string)).toMatchObject({
      amount: 19900,
      currency: 'INR',
    })
  })

  it('maps failures to HTTP statuses through the request handler', async () => {
    await seed()
    const respond = (uid: string) =>
      handleOrderRequest(
        new Request('https://example.test/api/razorpay-order', {
          method: 'POST',
          headers: { Authorization: 'Bearer t' },
          body: JSON.stringify({ registrationId: REGISTRATION_ID }),
        }),
        {
          razorpay: () => RAZORPAY,
          verifyIdToken: async () => ({ uid }),
          getDb: () => db,
          fetchImpl: asFetch(fakeRazorpay()),
        },
      )

    const notOwner = await respond(OTHER)
    expect(notOwner.status).toBe(403)
    expect(await notOwner.json()).toEqual({ error: 'This registration is not yours.' })
    expect((await respond(MEMBER)).status).toBe(200)
  })
})
