import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Receipt } from 'lucide-react'
import { Badge, Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useAuth } from '@/hooks/useAuth'
import { useMyRegistrations } from '@/hooks/useMyRegistrations'
import { formatEventDateShort, formatPrice } from '@/utils/format'
import type { PaymentStatus, Registration } from '@/types'

const PAYMENT_LABEL: Record<PaymentStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  not_required: { label: 'Free', tone: 'neutral' },
  pending: { label: 'Payment pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Payment failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}

function PurchaseRow({ registration }: { registration: Registration }) {
  const payment = PAYMENT_LABEL[registration.paymentStatus] ?? PAYMENT_LABEL.pending
  const amount =
    registration.paymentStatus === 'not_required'
      ? 'FREE'
      : formatPrice(registration.price, registration.currency)

  return (
    <Card as="li" className="overflow-hidden transition hover:border-brand-200 hover:shadow-lift">
      <Link to={`/tickets/${registration.id}`} className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-bold text-ink-900">{registration.eventTitle}</p>
          <p className="truncate text-sm text-ink-500">
            {formatEventDateShort(registration.eventDate)} · Ticket {registration.registrationCode}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={payment.tone}>{payment.label}</Badge>
            {registration.registrationStatus === 'cancelled' ? (
              <Badge tone="danger">Cancelled</Badge>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-base font-extrabold text-ink-900">{amount}</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
      </Link>
    </Card>
  )
}

export default function PurchaseHistoryPage() {
  const { user } = useAuth()
  const { all, loading, error } = useMyRegistrations(user?.uid)

  // Newest event first. Event dates are ISO strings (yyyy-mm-dd), so string order works.
  const rows = [...all].sort((a, b) => (a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0))

  const totalPaid = all
    .filter((registration) => registration.paymentStatus === 'paid')
    .reduce((sum, registration) => sum + (registration.price || 0), 0)
  const currency = all.find((registration) => registration.currency)?.currency ?? 'INR'

  return (
    <div>
      <Link
        to="/profile"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden /> Profile
      </Link>

      <header className="mb-5">
        <h1 className="font-display text-3xl font-extrabold text-ink-900">Purchase history</h1>
        <p className="mt-1 text-ink-500">Your event registrations and what you paid for them.</p>
      </header>

      {!loading && !error && all.length > 0 ? (
        <Card className="mb-5 flex items-center justify-between p-4">
          <span className="text-sm font-semibold text-ink-500">Total paid</span>
          <span className="font-display text-lg font-extrabold text-ink-900">
            {totalPaid > 0 ? formatPrice(totalPaid, currency) : 'FREE'}
          </span>
        </Card>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : error ? (
        <ErrorState description={error} onRetry={() => window.location.reload()} />
      ) : rows.length ? (
        <ul className="space-y-3">
          {rows.map((registration) => (
            <PurchaseRow key={registration.id} registration={registration} />
          ))}
        </ul>
      ) : (
        <EmptyState
          emoji="🧾"
          title="No purchases yet"
          description="Registrations for free and paid events appear here with their payment status."
          action={
            <Link to="/explore" className="font-semibold text-brand-600 hover:underline">
              <Receipt size={16} className="mr-1 inline" aria-hidden />
              Find a CrewDay
            </Link>
          }
        />
      )}
    </div>
  )
}
