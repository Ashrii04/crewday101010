import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { LinkButton } from '@/components/ui/Button'
import { Logo } from '@/components/layout/Logo'
import { useAuth } from '@/hooks/useAuth'

/** The rounded search field that sits under the logo row. */
export function SearchBar({
  defaultValue = '',
  placeholder = 'Search events, people, hobbies...',
}: {
  defaultValue?: string
  placeholder?: string
}) {
  const navigate = useNavigate()
  const [term, setTerm] = useState(defaultValue)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    navigate(term.trim() ? `/explore?q=${encodeURIComponent(term.trim())}` : '/explore')
  }

  return (
    <form onSubmit={submit} className="relative">
      <Search
        size={18}
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-400"
        aria-hidden
      />
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={placeholder}
        aria-label="Search events"
        className="h-12 w-full rounded-full bg-surface pr-4 pl-11 text-[0.95rem] text-ink-900 shadow-soft ring-1 ring-ink-100 outline-none transition placeholder:text-ink-400 focus:ring-2 focus:ring-brand-300"
      />
    </form>
  )
}

/** Compact header for phones and tablets; desktop uses the sidebar and top bar in UserLayout. */
export function AppHeader({ showSearch = false, unread = 0 }: { showSearch?: boolean; unread?: number }) {
  const { profile, isAuthenticated } = useAuth()

  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-surface lg:hidden">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link to={isAuthenticated ? '/home' : '/explore'} className="shrink-0">
            <Logo />
          </Link>

          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <Link
                to="/notifications"
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-surface text-ink-500 shadow-soft ring-1 ring-ink-100 transition hover:text-brand-500"
                aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
              >
                <Bell size={19} aria-hidden />
                {unread > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[0.6rem] font-bold text-white ring-2 ring-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </Link>
              <Link to="/profile" aria-label="Your profile">
                <Avatar
                  name={profile?.name || 'CrewDay'}
                  photoURL={profile?.photoURL}
                  size="md"
                  className="ring-2 ring-white shadow-soft"
                />
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="hidden rounded-full px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-surface sm:block"
              >
                Sign in
              </Link>
              <LinkButton to="/signup" size="sm">
                Join
              </LinkButton>
            </div>
          )}
        </div>

        {showSearch ? (
          <div className="pb-3">
            <SearchBar />
          </div>
        ) : null}
      </div>
    </header>
  )
}
