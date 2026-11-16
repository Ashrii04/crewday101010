import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  NotConfiguredError,
  handleOrderRequest,
  handleWebhookCore,
  handleWebhookRequest,
  type OrderRouteDeps,
  type WebhookRouteDeps,
} from '../api/_lib/payments'
import {
  getAdminApp,
  parseServiceAccount,
  projectIdFrom,
  razorpayKeysFrom,
  webhookSecretFrom,
} from '../api/_lib/runtime'
import * as orderRoute from '../api/razorpay-order'
import * as webhookRoute from '../api/razorpay-webhook'

/**
 * Request-level behaviour of the Vercel payment routes: methods, auth,
 * signatures and configuration. Every case here must be decided before the
 * database is needed, so the db is a trap that fails the test if it is touched.
 * The Firestore transaction logic is covered in paymentsApi.rules.test.ts.
 */

const SECRET = 'test-webhook-secret'
const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex')

const trapDb = vi.fn((): Firestore => {
  throw new Error('the database must not be touched')
})

afterEach(() => {
  trapDb.mockClear()
  vi.unstubAllEnvs()
})

/* ------------------------------- order route ------------------------------ */

function orderDeps(overrides: Partial<OrderRouteDeps> = {}): OrderRouteDeps {
  return {
    razorpay: () => ({ keyId: 'rzp_test_public', keySecret: 'test-key-secret' }),
    verifyIdToken: vi.fn(async (token: string) => {
      if (token !== 'good-token') throw new Error('bad token')
      return { uid: 'member-uid' }
    }),
    getDb: trapDb,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    ...overrides,
  }
}

function orderRequest(init: { method?: string; auth?: string; body?: string } = {}) {
  const method = init.method ?? 'POST'
  return new Request('https://example.test/api/razorpay-order', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init.auth ? { Authorization: init.auth } : {}),
    },
    body:
      method === 'GET'
        ? undefined
        : (init.body ?? JSON.stringify({ registrationId: 'event-1__member-uid' })),
  })
}

describe('POST /api/razorpay-order', () => {
  it.each(['GET', 'PUT', 'DELETE'])('answers 405 to %s', async (method) => {
    const deps = orderDeps()
    const response = await handleOrderRequest(orderRequest({ method, auth: 'Bearer good-token' }), deps)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(deps.verifyIdToken).not.toHaveBeenCalled()
  })

  it('answers 401 without a bearer token', async () => {
    const deps = orderDeps()
    const response = await handleOrderRequest(orderRequest(), deps)
    expect(response.status).toBe(401)
    expect(deps.verifyIdToken).not.toHaveBeenCalled()
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('answers 401 to a non-bearer Authorization header', async () => {
    const response = await handleOrderRequest(orderRequest({ auth: 'Basic Zm9vOmJhcg==' }), orderDeps())
    expect(response.status).toBe(401)
  })

  it('answers 401 when the ID token does not verify', async () => {
    const deps = orderDeps()
    const response = await handleOrderRequest(orderRequest({ auth: 'Bearer forged-token' }), deps)
    expect(response.status).toBe(401)
    expect(deps.verifyIdToken).toHaveBeenCalledWith('forged-token')
    expect(trapDb).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('forged-token')
  })

  it('answers 400 to a body without a usable registration id', async () => {
    for (const body of ['not json', '{}', '{"registrationId":42}', '{"registrationId":"a/b"}', 'null']) {
      const response = await handleOrderRequest(
        orderRequest({ auth: 'Bearer good-token', body }),
        orderDeps(),
      )
      expect(response.status).toBe(400)
    }
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('answers 503 when the Razorpay keys are missing, before looking at the caller', async () => {
    const deps = orderDeps({ razorpay: () => null })
    const response = await handleOrderRequest(orderRequest({ auth: 'Bearer good-token' }), deps)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Online payments are not set up yet' })
    expect(deps.verifyIdToken).not.toHaveBeenCalled()
  })

  it('answers 503 when Firebase credentials are missing', async () => {
    const deps = orderDeps({
      verifyIdToken: async () => {
        throw new NotConfiguredError()
      },
    })
    const response = await handleOrderRequest(orderRequest({ auth: 'Bearer good-token' }), deps)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Online payments are not set up yet' })
  })

  it('the real route is a 503 (not a crash) with no environment configured', async () => {
    for (const name of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'FIREBASE_SERVICE_ACCOUNT_JSON']) {
      vi.stubEnv(name, '')
    }
    const response = await orderRoute.POST(orderRequest({ auth: 'Bearer good-token' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Online payments are not set up yet' })
  })

  it('the real route refuses other methods', async () => {
    expect((await orderRoute.GET(orderRequest({ method: 'GET' }))).status).toBe(405)
  })
})

/* ------------------------------ webhook route ----------------------------- */

const PAYLOAD = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_1',
        order_id: 'order_1',
        amount: 19900,
        currency: 'INR',
        status: 'captured',
        notes: { registrationId: 'event-1__member-uid' },
      },
    },
  },
})

function webhookDeps(overrides: Partial<WebhookRouteDeps> = {}): WebhookRouteDeps {
  return { webhookSecret: () => SECRET, getDb: trapDb, ...overrides }
}

function webhookRequest(body: string, signature?: string, method = 'POST') {
  return new Request('https://example.test/api/razorpay-webhook', {
    method,
    headers: signature === undefined ? {} : { 'X-Razorpay-Signature': signature },
    body: method === 'GET' ? undefined : body,
  })
}

describe('POST /api/razorpay-webhook', () => {
  it('answers 405 to anything but POST', async () => {
    const response = await handleWebhookRequest(webhookRequest('', undefined, 'GET'), webhookDeps())
    expect(response.status).toBe(405)
    expect((await webhookRoute.GET(webhookRequest('', undefined, 'GET'))).status).toBe(405)
  })

  it('answers 503 when the webhook secret is not configured', async () => {
    const response = await handleWebhookRequest(
      webhookRequest(PAYLOAD, sign(PAYLOAD)),
      webhookDeps({ webhookSecret: () => null }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Online payments are not set up yet' })
  })

  it('the real route is a 503 (not a crash) with no secret configured', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', '')
    const response = await webhookRoute.POST(webhookRequest(PAYLOAD, sign(PAYLOAD)))
    expect(response.status).toBe(503)
  })

  it('answers 401 to a missing or wrong signature, without touching the database', async () => {
    for (const signature of [undefined, '', 'nonsense', sign(PAYLOAD, 'another-secret')]) {
      const response = await handleWebhookRequest(webhookRequest(PAYLOAD, signature), webhookDeps())
      expect(response.status).toBe(401)
    }
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('answers 400 to an empty body, without touching the database', async () => {
    const response = await handleWebhookRequest(webhookRequest('', sign('')), webhookDeps())
    expect(response.status).toBe(400)
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('answers 400 to a correctly signed body that is not JSON, without touching the database', async () => {
    const body = 'definitely not json'
    const response = await handleWebhookRequest(webhookRequest(body, sign(body)), webhookDeps())
    expect(response.status).toBe(400)
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('verifies the signature over the exact raw bytes', async () => {
    const signature = sign(PAYLOAD)
    const reserialised = JSON.stringify(JSON.parse(PAYLOAD), null, 2)
    expect(reserialised).not.toBe(PAYLOAD)
    expect(JSON.parse(reserialised)).toEqual(JSON.parse(PAYLOAD))

    // The same JSON with different whitespace no longer matches the signature.
    const response = await handleWebhookRequest(webhookRequest(reserialised, signature), webhookDeps())
    expect(response.status).toBe(401)
    expect(trapDb).not.toHaveBeenCalled()

    // And an appended trailing newline breaks it too.
    const trailing = await handleWebhookRequest(webhookRequest(`${PAYLOAD}\n`, signature), webhookDeps())
    expect(trailing.status).toBe(401)
  })

  it('acknowledges events it does not act on without touching the database', async () => {
    for (const body of [
      JSON.stringify({ event: 'payment.failed', payload: {} }),
      JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x' } } } }),
      JSON.stringify({ event: 'payment.authorized', payload: {} }),
      // a payment id that could escape a document path is never applied
      PAYLOAD.replace('"pay_1"', '"pay/../1"'),
    ]) {
      const result = await handleWebhookCore({
        db: trapDb,
        rawBody: body,
        signature: sign(body),
        webhookSecret: SECRET,
      })
      expect(result).toEqual({ status: 200, body: { status: 'ignored' } })
    }
    expect(trapDb).not.toHaveBeenCalled()
  })

  it('asks Razorpay to retry (500) when the database fails unexpectedly', async () => {
    const broken = {
      collection: () => {
        throw new Error('firestore exploded: secret-detail')
      },
    } as unknown as Firestore
    const result = await handleWebhookCore({
      db: broken,
      rawBody: PAYLOAD,
      signature: sign(PAYLOAD),
      webhookSecret: SECRET,
    })
    expect(result.status).toBe(500)
    expect(JSON.stringify(result.body)).not.toContain('secret-detail')
  })
})

/* ------------------------------ configuration ----------------------------- */

describe('runtime configuration', () => {
  const account = {
    type: 'service_account',
    project_id: 'crewday-2657d',
    client_email: 'payments@crewday-2657d.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  }

  it('reads the service account as plain JSON or base64', () => {
    const plain = JSON.stringify(account)
    expect(parseServiceAccount(plain)).toEqual(account)
    expect(parseServiceAccount(Buffer.from(plain).toString('base64'))).toEqual(account)
    expect(parseServiceAccount(`  ${plain}  `)).toEqual(account)
  })

  it('treats a missing, malformed or incomplete service account as unset', () => {
    expect(parseServiceAccount(undefined)).toBeNull()
    expect(parseServiceAccount('')).toBeNull()
    expect(parseServiceAccount('{ not json')).toBeNull()
    expect(parseServiceAccount('%%%')).toBeNull()
    expect(parseServiceAccount(JSON.stringify({ client_email: 'x' }))).toBeNull()
    expect(parseServiceAccount('"a string"')).toBeNull()
  })

  it('needs both Razorpay keys, and trims them', () => {
    expect(razorpayKeysFrom({})).toBeNull()
    expect(razorpayKeysFrom({ RAZORPAY_KEY_ID: 'rzp_test_1' })).toBeNull()
    expect(razorpayKeysFrom({ RAZORPAY_KEY_ID: ' rzp_test_1 ', RAZORPAY_KEY_SECRET: ' s ' })).toEqual({
      keyId: 'rzp_test_1',
      keySecret: 's',
    })
    expect(webhookSecretFrom({})).toBeNull()
    expect(webhookSecretFrom({ RAZORPAY_WEBHOOK_SECRET: ' w ' })).toBe('w')
  })

  it('finds the project id with a crewday-2657d fallback', () => {
    expect(projectIdFrom({})).toBe('crewday-2657d')
    expect(projectIdFrom({ VITE_FIREBASE_PROJECT_ID: 'from-vite' })).toBe('from-vite')
    expect(
      projectIdFrom({ FIREBASE_PROJECT_ID: 'explicit', VITE_FIREBASE_PROJECT_ID: 'from-vite' }),
    ).toBe('explicit')
  })

  it('refuses to start firebase-admin without credentials or an emulator', () => {
    expect(() => getAdminApp({})).toThrow(NotConfiguredError)
    expect(() => getAdminApp({ FIREBASE_SERVICE_ACCOUNT_JSON: 'garbage' })).toThrow(NotConfiguredError)
  })
})
