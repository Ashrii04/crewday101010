import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'

/**
 * Shared pieces of the pastel "clay" dashboards (admin and member).
 * Place ClayStat cards inside a `.stat-pastel` grid for the alternating
 * lilac / pink / butter / sky backgrounds.
 */

/** Pastel stat card: coloured icon square, label, big number, a small note. */
export function ClayStat({
  icon,
  iconClass,
  label,
  value,
  note,
}: {
  icon: ReactNode
  iconClass: string
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-3xl p-4 shadow-soft ring-1 ring-white/80">
      <span
        className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-2xl text-white shadow-soft',
          iconClass,
        )}
      >
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-ink-600">{label}</p>
      <p className="font-display text-3xl leading-tight font-extrabold text-ink-900">{value}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-mint-600">{note}</p>
    </div>
  )
}

/** Card heading with an optional "See All" pill. */
export function ClayCardTitle({ title, to }: { title: string; to?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-base font-extrabold text-ink-900">{title}</h2>
      {to ? (
        <Link
          to={to}
          className="rounded-full bg-white px-3 py-1 text-xs font-bold text-ink-600 shadow-soft hover:text-brand-600"
        >
          See All
        </Link>
      ) : null}
    </div>
  )
}
