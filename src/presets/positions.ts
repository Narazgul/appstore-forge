import type { Position } from '../types'

/**
 * Arrangements place one or more device frames inside the layout's device slot.
 * `dx`/`dy` are offsets from the slot centre in fractions of canvas width/height;
 * `source` picks which screenshot goes in that frame, so a multi-device arrangement
 * shows the neighbouring screens rather than repeating the same image.
 * `source: 'artwork'` takes the slot's own image and, with `frameless`, draws it bare.
 * Placements draw back to front.
 */
export const POSITIONS: Position[] = [
  {
    id: 'center',
    label: 'Single',
    placements: [{ source: 'self', dx: 0, dy: 0, scale: 1, rotate: 0 }],
  },
  {
    id: 'tilted',
    label: 'Tilted',
    placements: [{ source: 'self', dx: 0, dy: 0, scale: 0.98, rotate: -7 }],
  },
  {
    id: 'offset',
    label: 'Offset',
    placements: [{ source: 'self', dx: 0.15, dy: 0.01, scale: 1.06, rotate: -4 }],
  },
  {
    id: 'right',
    label: 'Pushed right',
    placements: [{ source: 'self', dx: 0.12, dy: 0.02, scale: 1, rotate: 0 }],
  },
  {
    id: 'lean',
    label: 'Lean',
    // Positive = clockwise on canvas: the top swings right, away from left-aligned copy.
    placements: [{ source: 'self', dx: 0, dy: 0, scale: 1, rotate: 10 }],
  },
  {
    id: 'corner',
    label: 'Corner',
    placements: [{ source: 'self', dx: 0.14, dy: 0.03, scale: 1, rotate: 10 }],
  },
  {
    id: 'wings',
    label: 'Wings',
    placements: [
      { source: 'next', dx: 0.23, dy: 0, scale: 1, rotate: -6 },
      { source: 'self', dx: -0.23, dy: 0, scale: 1, rotate: 6 },
    ],
  },
  {
    id: 'duo',
    label: 'Duo',
    placements: [
      { source: 'next', dx: -0.18, dy: -0.05, scale: 0.88, rotate: 0 },
      { source: 'self', dx: 0.14, dy: 0.05, scale: 1, rotate: 0 },
    ],
  },
  {
    id: 'duo-tilt',
    label: 'Duo tilt',
    placements: [
      { source: 'next', dx: -0.18, dy: -0.06, scale: 0.9, rotate: -6 },
      { source: 'self', dx: 0.16, dy: 0.06, scale: 1, rotate: -6 },
    ],
  },
  {
    id: 'duo-artwork',
    label: 'Duo artwork',
    placements: [
      { source: 'self', dx: -0.24, dy: -0.08, scale: 0.8, rotate: 0 },
      { source: 'artwork', dx: 0.25, dy: -0.08, scale: 0.84, rotate: 0, frameless: true },
    ],
  },
  {
    id: 'duo-artwork-tilt',
    label: 'Duo artwork tilt',
    placements: [
      { source: 'self', dx: -0.24, dy: -0.08, scale: 0.8, rotate: -6 },
      { source: 'artwork', dx: 0.25, dy: -0.08, scale: 0.84, rotate: -6, frameless: true },
    ],
  },
  {
    id: 'pair',
    label: 'Pair',
    placements: [
      { source: 'next', dx: 0.16, dy: -0.018, scale: 0.84, rotate: 7 },
      { source: 'self', dx: -0.09, dy: 0.018, scale: 0.94, rotate: -3 },
    ],
  },
  {
    id: 'trio',
    label: 'Trio',
    placements: [
      { source: 'prev', dx: -0.205, dy: 0.012, scale: 0.68, rotate: -11 },
      { source: 'next', dx: 0.205, dy: 0.012, scale: 0.68, rotate: 11 },
      { source: 'self', dx: 0, dy: -0.012, scale: 0.82, rotate: 0 },
    ],
  },
]

export const getPosition = (id: string): Position => POSITIONS.find((p) => p.id === id) ?? POSITIONS[0]
