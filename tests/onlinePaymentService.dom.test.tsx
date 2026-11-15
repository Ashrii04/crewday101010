/**
 * The browser side of order creation: what createRazorpayOrder sends to
 * /api/razorpay-order and how it reports failures. fetch and Firebase Auth are
 * stubbed; nothing leaves the process.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getIdToken = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({
  currentUser: null as { getIdToken: () => Promise<string> } | null,
}))

vi.mock('@/firebase/config', () => ({ auth: authState }))

import { createRazorpayOrder, OnlinePaymentError } from '@/services/onlinePaymentService'

const ORDER = { orderId: 'order_ABC123', amount: 19900, currency: 'INR', keyId: 'rzp_test_public' }
const fetchMock = vi.fn()

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

async function failure(): Promise<OnlinePaymentError> {
  const error = await createRazorpayOrder('event-1__user-1').catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(OnlinePaymentError)
  return error as OnlinePaymentError
}

beforeEach(() => {
  getIdToken.mockResolvedValue('id-token-123')
  authState.currentUser = { getIdToken }
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  getIdToken.mockReset()
  vi.unstubAllGlobals()
})

describe('createRazorpayOrder', () => {
  it('POSTs only the registration id, with the ID token as a bearer', async () => {
    reply(200, ORDER)

    await expect(createRazorpayOrder('event-1__user-1')).resolves.toEqual(ORDER)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/razorpay-order')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer id-token-123',
    })
    // No amount, price or status: the server decides all of that.
    expect(JSON.parse(init.body as string)).toEqual({ registrationId: 'event-1__user-1' })
  })

  it('asks for a sign-in, without calling the server, when nobody is signed in', async () => {
    authState.currentUser = null
    expect((await failure()).code).toBe('unauthenticated')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([503, 404])('maps %i to "not available" and points to UPI', async (status) => {
    reply(status, { error: 'x' })
    const error = await failure()
    expect(error.code).toBe('not-available')
    expect(error.message).toMatch(/UPI/)
  })

  it('maps 401 to a sign-in prompt', async () => {
    reply(401, { error: 'x' })
    const error = await failure()
    expect(error.code).toBe('unauthenticated')
    expect(error.message).toMatch(/sign in/i)
  })

  it.each([400, 403, 409, 500, 502])('maps %i to a retryable failure', async (status) => {
    reply(status, { error: 'x' })
    expect((await failure()).code).toBe('order-failed')
  })

  it('maps a network error to a retryable failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await failure()).code).toBe('order-failed')
  })

  it('rejects an OK reply that is not an order', async () => {
    reply(200, { orderId: 'order_1' })
    expect((await failure()).code).toBe('order-failed')
  })
})
