import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight, Heart, RotateCcw, X } from 'lucide-react'
import clsx from 'clsx'
import { Logo } from '@/components/layout/Logo'
import { Button, LinkButton } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Feedback'
import { EventRow } from '@/components/events/EventCard'
import { listPublishedEvents } from '@/services/eventService'
import { EMPTY_FILTERS, type CrewEvent } from '@/types'
import { CATEGORY_EMOJI } from '@/utils/constants'
import { formatEventDate, todayISO } from '@/utils/format'

/**
 * "Plan my CrewDay": a playful five-step question flow that ends in real,
 * matching events. Ask → celebrate → when → what → it's a CrewDay.
 */

type Step = 'ask' | 'yay' | 'when' | 'what' | 'done'
const STEPS: Step[] = ['ask', 'yay', 'when', 'what', 'done']

const SLOTS = [
  { id: 'morning', label: '7:00 AM', note: 'Sunrise people. Respect.', from: '00:00', to: '10:59' },
  { id: 'brunch', label: '11:00 AM', note: 'Brunch o’clock, obviously', from: '11:00', to: '13:59' },
  { id: 'afternoon', label: '3:00 PM', note: 'No alarms, no stress', from: '14:00', to: '16:59' },
  { id: 'golden', label: '5:30 PM', note: 'Golden hour is the best hour', from: '17:00', to: '18:59' },
  { id: 'night', label: '8:00 PM', note: 'Night owls, assemble', from: '19:00', to: '23:59' },
  { id: 'any', label: 'Any time', note: 'I’m flexible. Surprise me.', from: '00:00', to: '23:59' },
] as const

const VIBES = [
  { category: 'Music', note: 'Strings & songs' },
  { category: 'Dance', note: 'Two left feet ok' },
  { category: 'Sports', note: 'Sweat it out' },
  { category: 'Gaming', note: 'Controllers ready' },
  { category: 'Party', note: 'Lights, music, you' },
  { category: 'Food', note: 'Snacks are a vibe' },
  { category: 'Travel', note: 'Treks & trails' },
  { category: 'Art', note: 'Make something' },
  { category: 'Fitness', note: 'Move a little' },
] as const

const NO_LINES = ['Nope, catch me!', 'Too slow!', 'Missed me 😜', 'Still no?', 'Almost…', 'Okay, you win']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return iso(date)
}

/* -------------------------------- Pieces -------------------------------- */

function Badge({ emoji }: { emoji: string }) {
  return (
    <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-linear-to-br from-brand-100 to-grape-100 text-4xl shadow-soft ring-1 ring-white/80">
      <span aria-hidden>{emoji}</span>
      <span className="absolute -right-1.5 -bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white shadow-gold ring-2 ring-white">
        <Heart size={12} fill="currentColor" aria-hidden />
      </span>
    </div>
  )
}

function Heading({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub: string }) {
  return (
    <>
      <p className="text-[0.68rem] font-bold tracking-[0.22em] text-brand-600 uppercase">{eyebrow}</p>
      <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink-900">{title}</h1>
      <p className="mt-2 text-sm text-ink-500">{sub}</p>
    </>
  )
}

/** A burst of confetti from the card's centre; deterministic, so no layout jitter. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => {
        const angle = (index / 28) * Math.PI * 2
        const distance = 140 + (index % 4) * 38
        return {
          dx: `${Math.round(Math.cos(angle) * distance)}px`,
          dy: `${Math.round(Math.sin(angle) * distance)}px`,
          r: `${(index % 2 ? 1 : -1) * (120 + index * 9)}deg`,
          delay: `${(index % 5) * 40}ms`,
          content: ['🎉', '✨', '💛', '🧡', '⭐', '🎊', '💫'][index % 7],
        }
      }),
    [],
  )
  return (
    <div className="pointer-events-none absolute top-1/3 left-1/2" aria-hidden>
      {pieces.map((piece, index) => (
        <span
          key={index}
          className="absolute text-lg motion-safe:animate-[confetti-burst_1.1s_ease-out_both]"
          style={
            {
              '--dx': piece.dx,
              '--dy': piece.dy,
              '--r': piece.r,
              animationDelay: piece.delay,
            } as CSSProperties
          }
        >
          {piece.content}
        </span>
      ))}
    </div>
  )
}

function Calendar({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = todayISO()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const first = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const isCurrentMonth = iso(first).slice(0, 7) === today.slice(0, 7)
  const cells: Array<string | null> = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(cursor.year, cursor.month, i + 1))),
  ]
  const shift = (delta: number) =>
    setCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })

  return (
    <div className="rounded-3xl bg-surface p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={isCurrentMonth}
          className="rounded-full p-1.5 text-ink-600 transition hover:bg-white/70 disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="font-display text-base font-semibold text-ink-900">
          {first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded-full p-1.5 text-ink-600 transition hover:bg-white/70"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.7rem] font-semibold text-ink-400">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, index) =>
          date ? (
            <button
              key={date}
              type="button"
              disabled={date < today}
              onClick={() => onChange(date)}
              className={clsx(
                'mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition',
                date === value
                  ? 'bg-brand-500 font-bold text-white shadow-gold'
                  : 'text-ink-800 hover:bg-brand-50 disabled:text-ink-300 disabled:hover:bg-transparent',
                date === today && date !== value && 'ring-1 ring-brand-300',
              )}
              aria-pressed={date === value}
              aria-label={formatEventDate(date)}
            >
              {Number(date.slice(8))}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
    </div>
  )
}

/* --------------------------------- Page --------------------------------- */

export default function PlanCrewDayPage() {
  const [step, setStep] = useState<Step>('ask')
  const [dodges, setDodges] = useState(0)
  const [noPosition, setNoPosition] = useState({ x: 0, y: 0 })
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState<(typeof SLOTS)[number]['id'] | ''>('')
  const [vibes, setVibes] = useState<string[]>([])
  const [matches, setMatches] = useState<CrewEvent[] | null>(null)
  const [matchError, setMatchError] = useState(false)

  const gaveUp = dodges >= NO_LINES.length - 1
  const dodge = () => {
    if (gaveUp) return
    // Hop to a different spot below the question each time the pointer gets close.
    const angle = ((dodges * 137) % 360) * (Math.PI / 180)
    setNoPosition({ x: Math.round(Math.cos(angle) * 110), y: Math.round(Math.abs(Math.sin(angle)) * 56) })
    setDodges((count) => count + 1)
  }

  const chosenSlot = SLOTS.find((item) => item.id === slot)

  // Final step: real events in the chosen week, matching the vibes and time.
  useEffect(() => {
    if (step !== 'done' || !date) return
    let cancelled = false
    listPublishedEvents({
      filters: { ...EMPTY_FILTERS, dateFilter: 'custom', customDateFrom: date, customDateTo: addDays(date, 6) },
      pageSize: 40,
    })
      .then((page) => {
        if (cancelled) return
        const wanted = new Set(vibes)
        const scored = page.events
          .filter((event) => wanted.size === 0 || wanted.has(event.category))
          .map((event) => {
            const sameDay = event.date === date ? 2 : 0
            const inSlot = chosenSlot && event.startTime >= chosenSlot.from && event.startTime <= chosenSlot.to ? 1 : 0
            return { event, score: sameDay + inSlot }
          })
          .sort((a, b) => b.score - a.score || a.event.date.localeCompare(b.event.date))
        setMatches(scored.slice(0, 3).map((item) => item.event))
      })
      .catch(() => {
        if (!cancelled) setMatchError(true)
      })
    return () => {
      cancelled = true
    }
  }, [step, date, vibes, chosenSlot])

  const restart = () => {
    setStep('ask')
    setDodges(0)
    setNoPosition({ x: 0, y: 0 })
    setDate('')
    setSlot('')
    setVibes([])
    setMatches(null)
    setMatchError(false)
  }

  const exploreLink = `/explore?when=custom&from=${date}&to=${date ? addDays(date, 6) : ''}${vibes.length === 1 ? `&category=${encodeURIComponent(vibes[0])}` : ''}`

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/explore" aria-label="CrewDay home">
          <Logo />
        </Link>
        <Link
          to="/explore"
          className="rounded-full p-2.5 text-ink-600 transition hover:bg-white/60 hover:text-ink-900"
          aria-label="Close"
        >
          <X size={20} />
        </Link>
      </header>

      <main className="flex justify-center px-4 pt-2 pb-16">
        <section className="relative w-full max-w-md rounded-[2rem] bg-surface p-7 text-center shadow-lift sm:p-9">
          {step === 'yay' ? <Confetti /> : null}

          <div key={step} className="animate-fade-up">
            {step === 'ask' ? (
              <>
                <Badge emoji="🥳" />
                <Heading
                  eyebrow="A little question for you"
                  title="Will you join a CrewDay this weekend?"
                  sub="This is a yes-or-yes situation, btw."
                />
                <div className="relative mt-8 flex h-28 items-start justify-center gap-3">
                  <Button onClick={() => setStep('yay')} icon={<Heart size={16} fill="currentColor" />}>
                    Yes!
                  </Button>
                  <div
                    className="relative transition-transform duration-300 ease-out"
                    style={{ transform: `translate(${noPosition.x}px, ${noPosition.y}px)` }}
                  >
                    {dodges > 0 && !gaveUp ? (
                      <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-semibold whitespace-nowrap text-ink-700 shadow-soft">
                        {NO_LINES[Math.min(dodges - 1, NO_LINES.length - 1)]}
                      </span>
                    ) : null}
                    <Button
                      variant="outline"
                      onPointerEnter={dodge}
                      onPointerDown={(event) => {
                        if (!gaveUp) {
                          event.preventDefault()
                          dodge()
                        }
                      }}
                      onClick={() => gaveUp && setStep('yay')}
                    >
                      {gaveUp ? 'Fine… yes 🙃' : 'No'}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}

            {step === 'yay' ? (
              <>
                <Badge emoji="🤩" />
                <Heading
                  eyebrow="Plot twist!"
                  title="Wait… you actually said yes?!"
                  sub="I was so ready for you to say no."
                />
                <p className="mt-5 text-3xl" aria-hidden>
                  🎉 🔥 😄 💃
                </p>
                <Button className="mt-7" onClick={() => setStep('when')} icon={<ArrowRight size={16} />}>
                  Okay okay!
                </Button>
              </>
            ) : null}

            {step === 'when' ? (
              <div className="text-left">
                <div className="text-center">
                  <Heading
                    eyebrow="One tiny detail"
                    title="So… when are you free?"
                    sub="Pick a day, any day. I cleared my schedule."
                  />
                </div>
                <div className="mt-6">
                  <Calendar value={date} onChange={setDate} />
                </div>
                {date ? (
                  <div className="mt-6 animate-fade-up">
                    <p className="mb-2 text-center font-display text-lg font-semibold text-ink-900">What time?</p>
                    <ul className="space-y-2">
                      {SLOTS.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setSlot(item.id)}
                            aria-pressed={slot === item.id}
                            className={clsx(
                              'flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 text-left shadow-soft transition',
                              slot === item.id ? 'ring-2 ring-brand-500' : 'hover:bg-white/70',
                            )}
                          >
                            <span className="w-20 shrink-0 text-sm font-bold text-ink-900">{item.label}</span>
                            <span className="flex-1 text-xs text-ink-500">{item.note}</span>
                            {slot === item.id ? (
                              <Heart size={16} className="text-brand-500" fill="currentColor" aria-hidden />
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-7 text-center">
                  <Button disabled={!date || !slot} onClick={() => setStep('what')} icon={<ArrowRight size={16} />}>
                    Okay, next
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'what' ? (
              <>
                <Badge emoji="😋" />
                <Heading
                  eyebrow="The fun part"
                  title="What are you feeling?"
                  sub="You can pick more than one. No judgement."
                />
                <div className="mt-6 grid grid-cols-3 gap-2.5">
                  {VIBES.map((vibe) => {
                    const active = vibes.includes(vibe.category)
                    return (
                      <button
                        key={vibe.category}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setVibes((current) =>
                            active ? current.filter((item) => item !== vibe.category) : [...current, vibe.category],
                          )
                        }
                        className={clsx(
                          'relative rounded-2xl bg-surface px-2 py-3 shadow-soft transition active:scale-95',
                          active ? 'ring-2 ring-brand-500' : 'hover:-translate-y-0.5 hover:bg-white/70',
                        )}
                      >
                        {active ? (
                          <Heart
                            size={13}
                            className="absolute top-2 right-2 text-brand-500"
                            fill="currentColor"
                            aria-hidden
                          />
                        ) : null}
                        <span className="block text-2xl" aria-hidden>
                          {CATEGORY_EMOJI[vibe.category] ?? '✨'}
                        </span>
                        <span className="mt-1 block text-sm font-bold text-ink-900">{vibe.category}</span>
                        <span className="block text-[0.65rem] leading-tight text-ink-500">{vibe.note}</span>
                      </button>
                    )
                  })}
                </div>
                <Button
                  className="mt-7"
                  disabled={!vibes.length}
                  onClick={() => setStep('done')}
                  icon={<Heart size={16} fill="currentColor" />}
                >
                  {vibes.length > 1 ? 'These ones!' : 'This one!'}
                </Button>
              </>
            ) : null}

            {step === 'done' ? (
              <>
                <Badge emoji="🎊" />
                <Heading
                  eyebrow="Officially official"
                  title="It’s a CrewDay."
                  sub="No backing out now. (Okay, you can. But don’t.)"
                />
                <div className="mt-6 grid grid-cols-2 gap-3 rounded-3xl bg-surface p-4 text-left shadow-soft">
                  <div>
                    <p className="text-[0.65rem] font-bold tracking-[0.18em] text-brand-600 uppercase">When</p>
                    <p className="mt-1 text-sm font-semibold text-ink-900">{date ? formatEventDate(date) : ''}</p>
                    <p className="text-xs text-ink-500">{chosenSlot?.label}</p>
                  </div>
                  <div>
                    <p className="text-[0.65rem] font-bold tracking-[0.18em] text-brand-600 uppercase">Vibe</p>
                    <p className="mt-1 text-sm font-semibold text-ink-900">
                      {vibes.map((vibe) => `${CATEGORY_EMOJI[vibe] ?? '✨'} ${vibe}`).join(', ')}
                    </p>
                  </div>
                </div>

                <div className="mt-6 text-left">
                  <p className="mb-2 font-display text-lg font-semibold text-ink-900">Your crew is waiting at…</p>
                  {matchError ? (
                    <p className="rounded-2xl bg-surface p-4 text-sm text-ink-500 shadow-soft">
                      Couldn’t load events right now. Try the full list instead.
                    </p>
                  ) : matches === null ? (
                    <div className="space-y-2">
                      <Skeleton className="h-28 w-full rounded-3xl" />
                      <Skeleton className="h-28 w-full rounded-3xl" />
                    </div>
                  ) : matches.length ? (
                    <div className="space-y-2.5">
                      {matches.map((event) => (
                        <EventRow key={event.id} event={event} />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-surface p-4 text-sm text-ink-500 shadow-soft">
                      Nothing that week yet. New events go up every week, so check back soon.
                    </p>
                  )}
                </div>

                <div className="mt-7 flex flex-col items-center gap-2">
                  <LinkButton to={exploreLink} icon={<ArrowRight size={16} />}>
                    See all matching events
                  </LinkButton>
                  <button
                    type="button"
                    onClick={restart}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900"
                  >
                    <RotateCcw size={14} aria-hidden /> Start over
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <div className="mt-8 flex justify-center gap-1.5" aria-hidden>
            {STEPS.map((item) => (
              <span
                key={item}
                className={clsx(
                  'h-1.5 rounded-full transition-all duration-300',
                  item === step ? 'w-6 bg-brand-500' : 'w-1.5 bg-ink-300',
                )}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
