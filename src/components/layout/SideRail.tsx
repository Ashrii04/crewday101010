import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import { LogoMark } from '@/components/layout/Logo'

/**
 * Desktop sidebar shared by the member app and the admin area.
 *
 * At rest it is a slim icon rail tucked against the content box; hovering it
 * (or tabbing into it) slides it out to show labels. It overlays the page
 * instead of pushing it, so nothing jumps when it opens.
 */
export function SideRail({ top, children, bottom }: { top: ReactNode; children: ReactNode; bottom?: ReactNode }) {
  return (
    <aside className="group fixed top-6 bottom-6 left-6 z-30 hidden w-20 flex-col justify-between overflow-hidden rounded-[2.25rem] bg-linear-to-b from-brand-400 to-brand-500 p-4 shadow-lift transition-[width] duration-300 ease-out hover:w-56 focus-within:w-56 lg:flex">
      <div className="min-h-0 space-y-5 overflow-x-hidden overflow-y-auto no-scrollbar">
        {top}
        {children}
      </div>
      {bottom ? <div className="space-y-2 pt-3">{bottom}</div> : null}
    </aside>
  )
}

/** Class for a nav link inside the rail; pass to NavLink's `className`. */
export const railLink = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center justify-center overflow-hidden rounded-2xl px-[0.9rem] py-2.5 text-sm font-bold whitespace-nowrap transition group-hover:justify-start group-focus-within:justify-start',
    isActive ? 'bg-white text-brand-600 shadow-soft' : 'text-white/90 hover:bg-white/15 hover:text-white',
  )

/**
 * Link text for the rail. Zero width while the rail is closed, so only icons
 * show; it fades in a beat after the rail starts to open, never mid-slide.
 */
export function RailLabel({ children }: { children: ReactNode }) {
  return <span className="max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity,margin] duration-200 group-hover:ml-3 group-hover:max-w-44 group-hover:opacity-100 group-hover:delay-150 group-focus-within:ml-3 group-focus-within:max-w-44 group-focus-within:opacity-100">
      {children}
    </span>
}

/** Small avatar in the rail; large avatar and greeting once it opens. */
export function RailProfile({
  to,
  name,
  photoURL,
  greeting,
  showLogo,
}: {
  to: string
  name: string
  photoURL?: string
  greeting: string
  /** Guests have no avatar; show the CrewDay mark instead. */
  showLogo?: boolean
}) {
  return (
    <Link to={to} className="block pt-1 text-center">
      <span className="flex justify-center group-hover:hidden group-focus-within:hidden">
        {showLogo ? (
          <LogoMark className="h-12 w-12 ring-2 ring-white/80 shadow-soft" />
        ) : (
          <Avatar name={name} photoURL={photoURL} size="md" className="ring-2 ring-white/80 shadow-soft" />
        )}
      </span>
      <span className="hidden justify-center group-hover:flex group-focus-within:flex">
        {showLogo ? (
          <LogoMark className="h-20 w-20 ring-4 ring-white/80 shadow-soft" />
        ) : (
          <Avatar name={name} photoURL={photoURL} size="xl" className="ring-4 ring-white/80 shadow-soft" />
        )}
      </span>
      <p className="mt-2.5 hidden font-display text-lg font-extrabold whitespace-nowrap text-white group-hover:block group-focus-within:block">
        {greeting}
      </p>
    </Link>
  )
}

/** The pink crown card at the foot of the rail; only shown while it is open. */
export function RailCard({ title, text, to, cta }: { title: string; text: string; to: string; cta: string }) {
  return (
    <div className="hidden rounded-3xl bg-linear-to-b from-sky-100 to-sky-200 p-4 text-center shadow-soft group-hover:block group-focus-within:block">
      <p className="text-3xl" aria-hidden>
        👑
      </p>
      <p className="mt-1 font-display text-sm font-extrabold text-ink-900">{title}</p>
      <p className="mt-0.5 text-xs leading-snug text-ink-600">{text}</p>
      <Link
        to={to}
        className="mt-3 inline-flex rounded-full bg-linear-to-r from-sky-400 to-sky-500 px-5 py-1.5 text-xs font-bold text-white shadow-soft transition hover:from-sky-500 hover:to-sky-600"
      >
        {cta}
      </Link>
    </div>
  )
}

/** A plain action row at the foot of the rail, such as Sign out. */
export function RailAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex w-full items-center justify-center overflow-hidden rounded-2xl px-[0.9rem] py-2.5 text-sm font-bold whitespace-nowrap text-white/90 transition group-hover:justify-start group-focus-within:justify-start hover:bg-white/15 hover:text-white"
    >
      {icon}
      <RailLabel>{label}</RailLabel>
    </button>
  )
}
