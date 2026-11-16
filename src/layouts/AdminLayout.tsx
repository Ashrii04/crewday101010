import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarPlus,
  Heart,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareWarning,
  QrCode,
  Search,
  Ticket,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { Logo } from '@/components/layout/Logo'
import { RailAction, RailCard, RailLabel, RailProfile, SideRail, railLink } from '@/components/layout/SideRail'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/hooks/useAuth'
import { logout } from '@/services/authService'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/events', label: 'Events', icon: Ticket, end: false },
  { to: '/admin/events/new', label: 'Create event', icon: CalendarPlus, end: true },
  { to: '/admin/check-in', label: 'Check-in', icon: QrCode, end: false },
  { to: '/admin/requests', label: 'Requests', icon: Inbox, end: false },
  { to: '/admin/users', label: 'Users', icon: Users, end: false },
  { to: '/admin/interests', label: 'Interests', icon: Heart, end: false },
  { to: '/admin/reports', label: 'Reports', icon: MessageSquareWarning, end: false },
]

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin" className="flex flex-col gap-1.5">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-bold transition',
              isActive
                ? 'bg-white text-brand-600 shadow-soft'
                : 'text-white/90 hover:bg-white/15 hover:text-white',
            )
          }
        >
          <item.icon size={18} aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** The pink card at the foot of the sidebar: a shortcut to the member app. */
function UserAppCard() {
  return (
    <div className="rounded-3xl bg-linear-to-b from-sky-100 to-sky-200 p-4 text-center shadow-soft">
      <p className="text-3xl" aria-hidden>
        👑
      </p>
      <p className="mt-1 font-display text-sm font-extrabold text-ink-900">User app</p>
      <p className="mt-0.5 text-xs leading-snug text-ink-600">See CrewDay the way members do.</p>
      <Link
        to="/home"
        className="mt-3 inline-flex rounded-full bg-linear-to-r from-sky-400 to-sky-500 px-5 py-1.5 text-xs font-bold text-white shadow-soft transition hover:from-sky-500 hover:to-sky-600"
      >
        Open
      </Link>
    </div>
  )
}

export function AdminLayout() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [query, setQuery] = useState('')

  const name = profile?.name || 'Admin'
  const firstName = name.split(' ')[0]
  const onDashboard = location.pathname === '/admin'

  const handleLogout = async () => {
    await logout()
    navigate('/admin/login', { replace: true })
  }

  const onSearch = (event: FormEvent) => {
    event.preventDefault()
    const term = query.trim()
    if (term) navigate(`/admin/users?q=${encodeURIComponent(term)}`)
  }

  return (
    <div className="min-h-dvh lg:p-6">
      {/* Desktop sidebar: a slim icon rail that slides out on hover */}
      <SideRail
        top={<RailProfile to="/admin" name={name} photoURL={profile?.photoURL} greeting={`Hi, ${firstName}!`} />}
        bottom={
          <>
            <RailCard title="User app" text="See CrewDay the way members do." to="/home" cta="Open" />
            <RailAction
              icon={<LogOut size={18} className="shrink-0" aria-hidden />}
              label="Sign out"
              onClick={() => void handleLogout()}
            />
          </>
        }
      >
        <nav aria-label="Admin" className="flex flex-col gap-1.5">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={railLink} title={item.label}>
              <item.icon size={18} className="shrink-0" aria-hidden />
              <RailLabel>{item.label}</RailLabel>
            </NavLink>
          ))}
        </nav>
      </SideRail>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-16 items-center justify-between bg-linear-to-r from-brand-400 to-brand-500 px-4 lg:hidden">
        <Link to="/admin">
          <Logo variant="light" />
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl p-2 text-white"
          aria-label="Open admin menu"
        >
          <Menu size={22} aria-hidden />
        </button>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-obsidian/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 animate-fade-in flex-col justify-between rounded-r-[2rem] bg-linear-to-b from-brand-400 to-brand-500 p-4 shadow-lift">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-extrabold text-white">Hi, {firstName}!</p>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-xl p-2 text-white"
                  aria-label="Close menu"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="space-y-2">
              <UserAppCard />
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white/90 hover:bg-white/15 hover:text-white"
              >
                <LogOut size={17} aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* The cream content box */}
      <main className="min-w-0 px-4 py-6 lg:ml-15 lg:min-h-[calc(100dvh-3rem)] lg:rounded-[2.5rem] lg:bg-[#fdf6fb]/85 lg:py-6 lg:pr-7 lg:pl-14 lg:shadow-lift lg:ring-1 lg:ring-white/80">
        {/* Desktop top bar: title, search, notifications, profile */}
        <div className="mb-6 hidden items-center gap-4 lg:flex">
          <p className="w-44 shrink-0 font-display text-2xl font-extrabold text-ink-900">
            {onDashboard ? 'Dashboard' : ''}
          </p>
          <form onSubmit={onSearch} className="relative max-w-sm flex-1" role="search">
            <Search
              size={17}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members by name or email…"
              aria-label="Search members"
              className="h-11 w-full rounded-full bg-white pr-4 pl-11 text-sm text-ink-900 shadow-soft outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-300"
            />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <Link
              to="/admin/requests"
              aria-label="Event requests"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-500 shadow-soft transition hover:text-brand-600"
            >
              <Bell size={19} aria-hidden />
            </Link>
            <Link to="/home" aria-label="Open the user app">
              <Avatar name={name} photoURL={profile?.photoURL} size="sm" className="ring-2 ring-white shadow-soft" />
            </Link>
          </div>
        </div>

        <Outlet />
      </main>
    </div>
  )
}
