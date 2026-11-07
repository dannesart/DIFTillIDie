import { describe, expect, it } from 'vitest'
import { focusDestination } from '../app/lib/composerState'

/* Where focus went when it left the post composer (it closes its Story suggestions only for "outside"). */

describe('where focus went', () => {
  const inside = { id: 'select' }
  const form = { contains: (n: unknown) => n === inside }
  it('classifies a focusout by its relatedTarget', () => {
    expect(focusDestination(form, null)).toBe('nowhere')
    expect(focusDestination(form, inside as unknown as EventTarget)).toBe('inside')
    expect(focusDestination(form, { id: 'elsewhere' } as unknown as EventTarget)).toBe('outside')
    expect(focusDestination(null, { id: 'x' } as unknown as EventTarget)).toBe('outside')
  })
})
