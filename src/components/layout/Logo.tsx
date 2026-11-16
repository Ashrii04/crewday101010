import clsx from 'clsx'
import { CrewEmblem } from '@/components/layout/CrewEmblem'

/**
 * The CrewDay mark: the CD emblem (a C opening into a D) on a white tile.
 * Vector, so it is crisp at every size and needs no network request.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-[22%] bg-white shadow-soft',
        className,
      )}
    >
      <CrewEmblem className="h-[86%] w-[86%]" />
    </span>
  )
}

export function Logo({
  variant = 'dark',
  withWordmark = true,
  withTagline = false,
  className,
}: {
  variant?: 'dark' | 'light'
  withWordmark?: boolean
  /** The "Meet · Explore · Do · Belong" strip, for large placements only. */
  withTagline?: boolean
  className?: string
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="h-10 w-10 shrink-0 drop-shadow-sm" />

      {withWordmark ? (
        <span className="flex flex-col leading-none">
          <span className="font-display text-lg font-extrabold tracking-tight">
            {variant === 'light' ? (
              <span className="text-white">CREWDAY</span>
            ) : (
              <>
                <span className="text-brand-600">CREW</span>
                <span className="text-sky-500">DAY</span>
              </>
            )}
          </span>
          <span
            className={clsx(
              'mt-0.5 text-[0.55rem] font-semibold tracking-[0.24em]',
              variant === 'light' ? 'text-white/60' : 'text-ink-400',
            )}
          >
            SOCIAL APP
          </span>
          {withTagline ? (
            <span
              className={clsx(
                'mt-1 text-[0.6rem] font-medium',
                variant === 'light' ? 'text-white/55' : 'text-ink-400',
              )}
            >
              Meet · Explore · Do · Belong
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
