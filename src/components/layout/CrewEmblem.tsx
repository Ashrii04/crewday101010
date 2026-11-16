import { useId } from 'react'

/**
 * The CrewDay emblem as vector strokes: a C opening into a D, after the
 * monogram. Same geometry as the assembling intro in `index.html`, so the
 * in-app loader picks up where the first-visit intro leaves off.
 */
export function CrewEmblem({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const metal = `cd-metal-${id}`
  const glow = `cd-glow-${id}`

  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label="CrewDay">
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5f3fbb" />
          <stop offset="0.45" stopColor="#8b6ae6" />
          <stop offset="0.75" stopColor="#f97ba4" />
          <stop offset="1" stopColor="#ef5d8f" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#f97ba4" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#ef5d8f" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ef5d8f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill={`url(#${glow})`} />
      <g fill="none" stroke={`url(#${metal})`} strokeLinecap="round">
        <path d="M138 50 A64 64 0 1 0 138 150" strokeWidth="16" />
        <path d="M90 66 V134" strokeWidth="13" />
        <path d="M90 66 H104 A34 34 0 0 1 104 134 H90" strokeWidth="13" />
      </g>
    </svg>
  )
}
