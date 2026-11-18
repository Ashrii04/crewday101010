import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { ErrorState, InlineAlert, Skeleton } from '@/components/ui/Feedback'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import {
  getPaymentSettings,
  PAYEE_NAME_MAX,
  savePaymentSettings,
  validatePaymentSettings,
  type PaymentSettingsErrors,
} from '@/services/paymentService'

export default function AdminPaymentsPage() {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()

  const [upiId, setUpiId] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [configured, setConfigured] = useState(false)
  const [errors, setErrors] = useState<PaymentSettingsErrors>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    getPaymentSettings()
      .then((settings) => {
        setUpiId(settings?.upiId ?? '')
        setPayeeName(settings?.payeeName ?? '')
        setConfigured(Boolean(settings))
      })
      .catch(() => setLoadError('We could not load the payment settings.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user) return
    const found = validatePaymentSettings({ upiId, payeeName })
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    try {
      const saved = await savePaymentSettings({ upiId, payeeName }, user.uid)
      setUpiId(saved.upiId)
      setPayeeName(saved.payeeName)
      setConfigured(true)
      success('Payment details saved.')
    } catch {
      toastError('We could not save the payment details. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="font-display text-3xl font-extrabold text-ink-900">Payments</h1>
        <p className="mt-1 text-ink-500">
          Where attendees of paid events send their UPI payment.
        </p>
      </header>

      {loading ? (
        <Skeleton className="h-72 w-full max-w-xl rounded-card" />
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={load} />
      ) : (
        <Card className="max-w-xl p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <Wallet size={20} aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">UPI details</h2>
              <p className="text-sm text-ink-500">
                {configured ? 'Attendees can pay you now.' : 'Not set up yet: attendees cannot pay.'}
              </p>
            </div>
          </div>

          <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
            <Input
              label="UPI ID"
              required
              value={upiId}
              onChange={(event) => setUpiId(event.target.value)}
              placeholder="name@bank"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.upiId}
              hint="The address you receive payments on, for example crewday@okaxis."
            />
            <Input
              label="Payee name"
              required
              value={payeeName}
              maxLength={PAYEE_NAME_MAX + 20}
              onChange={(event) => setPayeeName(event.target.value)}
              placeholder="CrewDay Events"
              autoComplete="off"
              error={errors.payeeName}
              hint="Shown in the attendee's UPI app when they pay. Up to 60 characters."
            />

            <InlineAlert tone="info">
              Attendees pay you directly. After the money arrives, open the event&apos;s attendee
              list and press <strong>Mark paid</strong> to confirm their seat.
            </InlineAlert>

            <Button type="submit" loading={saving}>
              Save payment details
            </Button>
          </form>
        </Card>
      )}
    </div>
  )
}
