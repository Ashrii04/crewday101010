import { useEffect, useState, type ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Smartphone } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { InlineAlert, Skeleton } from '@/components/ui/Feedback'
import { OnlineCheckoutButton } from '@/components/payments/OnlineCheckoutButton'
import { getPaymentSettings } from '@/services/paymentService'
import { ONLINE_PAYMENTS } from '@/utils/constants'
import { formatPrice } from '@/utils/format'
import { buildUpiLink } from '@/utils/upi'
import type { PaymentSettings, Registration } from '@/types'

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the value
      // is on screen to select by hand.
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={label}
      icon={copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      onClick={() => void copy()}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

type SettingsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; settings: PaymentSettings | null }

/**
 * Pay-by-UPI instructions for a registration that is waiting for payment.
 *
 * Renders nothing for any other state, so a page that subscribes to the
 * registration can drop it in unconditionally and it disappears the moment an
 * organiser confirms the payment. The seat itself is only confirmed by that
 * organiser action; nothing here can mark anyone as paid.
 */
export function PaymentPanel({
  registration,
  onlineCheckout,
}: {
  registration: Registration
  /**
   * OPTIONAL SLOT: an online checkout button (card, netbanking, wallet) can be
   * passed here and is rendered above the UPI option. Left out, the panel is
   * UPI-only.
   */
  onlineCheckout?: ReactNode
}) {
  const [state, setState] = useState<SettingsState>({ status: 'loading' })
  const pending = registration.registrationStatus === 'pending_payment'
  // An explicit slot wins; otherwise the online button appears only when the
  // deployment has switched online payments on.
  const online = onlineCheckout ?? (ONLINE_PAYMENTS ? <OnlineCheckoutButton registration={registration} /> : null)

  // Bumped by "Try again"; the fetch below re-runs when it changes.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    getPaymentSettings()
      .then((settings) => {
        if (!cancelled) setState({ status: 'ready', settings })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [pending, attempt])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((count) => count + 1)
  }

  if (!pending) return null

  const amountLabel = formatPrice(registration.price, registration.currency)
  // UPI only moves rupees; anything else has to be settled with the organiser.
  const payableByUpi = registration.currency === 'INR' && registration.price > 0

  let upiOption: ReactNode
  if (state.status === 'loading') {
    upiOption = <Skeleton className="h-40 w-full rounded-2xl" />
  } else if (state.status === 'error') {
    upiOption = (
      <div className="space-y-3">
        <InlineAlert tone="danger">We could not load the payment details.</InlineAlert>
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  } else if (!payableByUpi) {
    upiOption = (
      <InlineAlert tone="warning">
        This event is priced in {registration.currency}, which cannot be paid by UPI. Please contact
        the organiser to arrange payment.
      </InlineAlert>
    )
  } else if (!state.settings) {
    upiOption = (
      <InlineAlert tone="warning">
        The organiser hasn’t set up payments yet — contact them to arrange payment. Your seat stays
        held in the meantime.
      </InlineAlert>
    )
  } else {
    const { upiId, payeeName } = state.settings
    const link = buildUpiLink({
      upiId,
      payeeName,
      amount: registration.price,
      registrationCode: registration.registrationCode,
      eventTitle: registration.eventTitle,
    })

    upiOption = (
      <div className="space-y-4">
        <a
          href={link}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-5 text-[0.95rem] font-semibold text-white shadow-pink transition hover:bg-brand-600 active:scale-[0.98]"
        >
          <Smartphone size={18} aria-hidden />
          Pay with UPI app
        </a>

        <div className="flex flex-col items-center gap-2">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-ink-100">
            <QRCodeSVG
              value={link}
              size={176}
              level="M"
              marginSize={1}
              title={`UPI payment QR code for ${amountLabel}`}
            />
          </div>
          <p className="text-center text-xs text-ink-500">
            On a computer? Scan this with any UPI app on your phone.
          </p>
        </div>

        <div className="space-y-2 rounded-2xl bg-ink-50 p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ink-500">Pay to</p>
              <p className="truncate font-mono font-bold text-ink-900">{upiId}</p>
              <p className="truncate text-xs text-ink-500">{payeeName}</p>
            </div>
            <CopyButton value={upiId} label="Copy UPI ID" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-2">
            <div className="min-w-0">
              <p className="text-ink-500">Payment note</p>
              <p className="font-mono font-bold text-ink-900">{registration.registrationCode}</p>
            </div>
            <CopyButton value={registration.registrationCode} label="Copy registration ID" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="font-display text-lg font-bold text-ink-900">Complete your payment</h2>
      <p className="mt-1 text-sm text-ink-500">
        Amount to pay{' '}
        <span className="font-display text-base font-extrabold text-ink-900">{amountLabel}</span>
      </p>

      {online ? <div className="mt-4">{online}</div> : null}

      <div className="mt-4">{upiOption}</div>

      <p className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-700">
        Your seat is held for you. It is confirmed once the organiser sees your payment and marks it
        as received, then your QR code activates here automatically. Keep your registration ID in
        the payment note so they can match it.
      </p>
    </Card>
  )
}
