import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  Home,
  LayoutDashboard,
  Lightbulb,
  LogIn,
  LogOut,
  Settings,
  Ticket,
  User,
} from 'lucide-react'
import { AppHeader, SearchBar } from '@/components/layout/AppHeader'
import { BottomNav } from '@/components/layout/BottomNav'
import { GuestBanner } from '@/components/layout/GuestBanner'
import { RailAction, RailCard, RailLabel, RailProfile, SideRail, railLink } from '@/components/layout/SideRail'
import { Avatar } from '@/components/ui/Avatar'
import { LinkButton } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/Feedback'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { logout } from '@/services/authService'
import { onForegroundPush } from '@/services/messagingService'

const MEMBER_NAV = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/explore', label: 'Events', icon: CalendarDays },
  { to: '/my-events', label: 'Tickets', icon: Ticket },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/suggest', label: 'Suggest event', icon: Lightbulb },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
]
const GUEST_NAV = [
  { to: '/explore', label: 'Events', icon: CalendarDays },
  { to: '/login', label: 'Sign in', icon: LogIn },
]

/** Title shown in the desktop top bar, by route. */
function pageTitle(pathname: string): string {
  if (pathname === '/home') return 'Dashboard'
  if (pathname.startsWith('/explore')) return 'Events'
  if (pathname.startsWith('/events/')) return 'Event'
  if (pathname.startsWith('/my-events') || pathname.startsWith('/tickets')) return 'Tickets'
  if (pathname.startsWith('/notifications')) return 'Notifications'
  if (pathname.startsWith('/suggest')) return 'Suggest'
  if (pathname.startsWith('/profile')) return 'Profile'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/purchases')) return 'Purchases'
  return ''
}

export function UserLayout() {
  const { profile, isAuthenticated, isAdmin } = useAuth()
  const { info } = useToast()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const unread = useUnreadNotifications()

  // Surface pushes that arrive while the app is open (the service worker only
  // fires when the tab is backgrounded).
  useEffect(() => {
    let dispose: (() => void) | undefined
    void onForegroundPush((payload) => info(payload.title)).then((unsubscribe) => {
      dispose = unsubscribe
    })
    return () => dispose?.()
  }, [info])

  const name = profile?.name?.trim() || 'CrewDay'
  const firstName = profile?.name?.trim().split(/\s+/)[0]
  const nav = isAuthenticated ? MEMBER_NAV : GUEST_NAV

  const handleLogout = async () => {
    await logout()
    navigate('/explore', { replace: true })
  }

  return (
    <div className="min-h-dvh lg:p-6">
      {/* Desktop sidebar: a slim icon rail that slides out on hover */}
      <SideRail
        top={
          <RailProfile
            to={isAuthenticated ? '/profile' : '/explore'}
            name={name}
            photoURL={profile?.photoURL}
            greeting={`Hi, ${firstName || 'there'}!`}
            showLogo={!isAuthenticated}
          />
        }
        bottom={
          <>
            <RailCard
              title={isAuthenticated ? 'Plan my CrewDay' : 'Join CrewDay'}
              text={isAuthenticated ? 'Answer 3 fun questions, get a plan.' : 'Save tickets and find your crew.'}
              to={isAuthenticated ? '/plan' : '/signup'}
              cta={isAuthenticated ? 'Start' : 'Sign up'}
            />
            {isAuthenticated ? (
              <RailAction
                icon={<LogOut size={18} className="shrink-0" aria-hidden />}
                label="Sign out"
                onClick={() => void handleLogout()}
              />
            ) : null}
          </>
        }
      >
        <nav aria-label="Primary" className="flex flex-col gap-1.5">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={railLink} title={item.label}>
              <item.icon size={18} className="shrink-0" aria-hidden />
              <RailLabel>{item.label}</RailLabel>
            </NavLink>
          ))}
          {isAdmin ? (
            <NavLink to="/admin" className={railLink} title="Admin">
              <LayoutDashboard size={18} className="shrink-0" aria-hidden />
              <RailLabel>Admin</RailLabel>
            </NavLink>
          ) : null}
        </nav>
      </SideRail>

      {/* The cream content box (a plain page on phones) */}
      <div className="min-w-0 flex-1 lg:ml-15 lg:min-h-[calc(100dvh-3rem)] lg:rounded-[2.5rem] lg:bg-[#fdf6fb]/85 lg:py-6 lg:pr-7 lg:pl-14 lg:shadow-lift lg:ring-1 lg:ring-white/80">
        {/* Phones and tablets keep the compact header. Explore owns its own
            search box; showing the header one too gave that screen two. */}
        <AppHeader showSearch={pathname === '/home'} unread={unread} />

        {/* Desktop top bar: title, search, notifications, profile */}
        <div className="mb-6 hidden items-center gap-4 lg:flex">
          <p className="w-44 shrink-0 font-display text-2xl font-extrabold text-ink-900">{pageTitle(pathname)}</p>
          <div className="max-w-sm flex-1">
            {pathname.startsWith('/explore') ? null : <SearchBar placeholder="Search events, hobbies…" />}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <Link
                  to="/notifications"
                  aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                  className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-500 shadow-soft transition hover:text-brand-600"
                >
                  <Bell size={19} aria-hidden />
                  {unread > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-sky-500 px-1 text-[0.62rem] font-bold text-white ring-2 ring-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </Link>
                <Link to="/profile" aria-label="Your profile">
                  <Avatar name={name} photoURL={profile?.photoURL} size="sm" className="ring-2 ring-white shadow-soft" />
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-full px-4 py-2 text-sm font-bold text-ink-600 hover:bg-white/70">
                  Sign in
                </Link>
                <LinkButton to="/signup" size="sm">
                  Join
                </LinkButton>
              </>
            )}
          </div>
        </div>

        <GuestBanner />

        {profile?.status === 'suspended' ? (
          <div className="mx-auto max-w-6xl px-4 pt-4 lg:mx-0 lg:max-w-none lg:px-0 lg:pt-0 lg:pb-4">
            <InlineAlert tone="danger">
              Your account is suspended, so you cannot register for events. Contact support if you
              think this is a mistake.
            </InlineAlert>
          </div>
        ) : null}

        <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 lg:mx-0 lg:max-w-none lg:px-0 lg:pt-0 lg:pb-2">
          {/* Keyed on the path so each screen fades in rather than snapping
              into place — the difference between "a website" and "an app".
              Respects prefers-reduced-motion via the global CSS rule. */}
          <div key={pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
