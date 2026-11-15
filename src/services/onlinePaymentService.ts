import { firebaseApp } from '@/firebase/config'
import type { Registration } from '@/types'

/**
 * Online payment through Razorpay Checkout.
 *
 * Nothing here decides that a payment succeeded. The browser asks the
 * `createRazorpayOrder` Cloud Function for an order (the function reads the
 * price from the event, so no amount is ever sent from here), shows Razorpay's
 * own checkout, and then waits. The seat is confirmed by the signed
 * `razorpayWebhook` function, and the page learns of it through the live
 * registration subscription it already has.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

export interface RazorpayOrder {
  orderId: string
  amount: number
  currency: string
  keyId: string
}

interface CheckoutOptions {
  key: string
  amount: number
  currency: string
  order_id: string
  name: string
  description: string
  prefill: { name: string; email: string; contact: string }
  notes: Record<string, string>
  theme: { color: string }
  handler: () => void
  modal: { ondismiss: () => void }
}

interface CheckoutInstance {
  open: () => void
  on: (event: 'payment.failed', handler: (response: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => CheckoutInstance
  }
}

export class OnlinePaymentError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'OnlinePaymentError'
  }
}

let scriptPromise: Promise<void> | null = null

/** Load Razorpay's checkout script once; reject (and allow a retry) if it is blocked. */
export function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      script.remove()
      reject(new OnlinePaymentError('script-blocked', 'Could not load the payment window.'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/** Ask the server for an order for this registration. The amount is decided there. */
export async function createRazorpayOrder(registrationId: string): Promise<RazorpayOrder> {
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const call = httpsCallable<{ registrationId: string }, RazorpayOrder>(
    getFunctions(firebaseApp, 'asia-south1'),
    'createRazorpayOrder',
  )
  try {
    const result = await call({ registrationId })
    return result.data
  } catch (caught) {
    const code = (caught as { code?: string }).code ?? ''
    if (code.endsWith('failed-precondition') || code.endsWith('not-found') || code.endsWith('unavailable')) {
      throw new OnlinePaymentError(
        'not-available',
        'Online payment is not available right now. Pay by UPI below instead.',
      )
    }
    throw new OnlinePaymentError('order-failed', 'Could not start the payment. Please try again.')
  }
}

/**
 * Open Razorpay's checkout for an order. Resolves `paid` when the checkout
 * reports success (the seat is still confirmed by the server afterwards),
 * `dismissed` if the person closes it, or `failed` if the payment is declined.
 */
export function openCheckout(
  order: RazorpayOrder,
  registration: Registration,
): Promise<'paid' | 'dismissed' | 'failed'> {
  return new Promise((resolve) => {
    const Razorpay = window.Razorpay
    if (!Razorpay) {
      resolve('failed')
      return
    }
    const checkout = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'CrewDay',
      description: registration.eventTitle,
      prefill: {
        name: registration.name,
        email: registration.email,
        contact: registration.phone,
      },
      notes: { registrationId: registration.id },
      theme: { color: '#ec4899' },
      handler: () => resolve('paid'),
      modal: { ondismiss: () => resolve('dismissed') },
    })
    checkout.on('payment.failed', () => resolve('failed'))
    checkout.open()
  })
}
