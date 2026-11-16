import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { CrewEvent } from '@/types'

/**
 * Organic photo collage for the landing hero: event photos in soft blob
 * shapes, loosely stacked like prints on a table. Uses real event photos;
 * with fewer than three, warm abstract shapes stand in rather than stock art.
 */
const SHAPES = [
  { radius: '42% 58% 63% 37% / 41% 44% 56% 59%', aspect: 'aspect-square', className: 'col-span-2 row-span-2 rotate-[-3deg]' },
  { radius: '58% 42% 38% 62% / 52% 61% 39% 48%', aspect: 'aspect-square', className: 'translate-y-6 rotate-[4deg]' },
  { radius: '50% 50% 34% 66% / 56% 38% 62% 44%', aspect: 'aspect-square', className: '-translate-y-2 rotate-[-2deg]' },
  { radius: '36% 64% 55% 45% / 47% 52% 48% 53%', aspect: 'aspect-square', className: 'rotate-[3deg]' },
  { radius: '61% 39% 47% 53% / 40% 58% 42% 60%', aspect: 'aspect-[2/1]', className: 'col-span-2 -translate-y-4 rotate-[-4deg]' },
]

const FALLBACK = [
  'from-brand-500 to-grape-500',
  'from-grape-500 to-brand-300',
  'from-sky-400 to-brand-400',
  'from-brand-400 to-grape-300',
  'from-grape-400 to-brand-600',
]

export function HeroCollage({ events }: { events: CrewEvent[] }) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const photos = events.filter((event) => event.imageURL && !broken.has(event.id)).slice(0, SHAPES.length)
  const usePhotos = photos.length >= 3

  return (
    <div className="relative hidden lg:block" aria-hidden={!usePhotos}>
      <div className="absolute inset-8 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
      <div className="relative grid grid-cols-3 grid-rows-3 gap-4">
        {SHAPES.map((shape, index) => {
          // Never repeat a photo; spare shapes stay as warm gradient blobs.
          const event = usePhotos ? photos[index] : undefined
          const tile = (
            <div
              className={clsx(
                'relative w-full overflow-hidden shadow-lift ring-1 ring-white/15 transition duration-500 hover:scale-[1.03]',
                shape.aspect,
                !event && 'bg-linear-to-br opacity-80',
                !event && FALLBACK[index],
              )}
              style={{ borderRadius: shape.radius }}
            >
              {event ? (
                <img
                  src={event.imageURL}
                  alt={event.title}
                  loading="eager"
                  decoding="async"
                  onError={() => setBroken((previous) => new Set(previous).add(event.id))}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
          )
          return (
            <div key={index} className={shape.className}>
              {event ? (
                <Link to={`/events/${event.id}`} className="block h-full" title={event.title}>
                  {tile}
                </Link>
              ) : (
                tile
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
