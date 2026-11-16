import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/* Följer in Snacket's own control and feed: the same control, the same cards, honest states. */

const section = readFileSync('app/components/SnacketSection.vue', 'utf8')

describe('Snacket: Hetast | Nyast | Följer', () => {
  it('one control with three sorts, in that order, its marker following the choice', () => {
    const labels = [...section.matchAll(/\{ value: '(\w+)', label: '([^']+)'/g)].map(m => [m[1], m[2]])
    expect(labels).toEqual([['hetast', 'Hetast'], ['nyast', 'Nyast'], ['foljer', 'Följer']])
    expect(section).toContain('grid grid-cols-3')
    expect(section).toContain('translateX(${sortIndex * 100}%)')
    expect(section.match(/role="tablist"/g)).toHaveLength(1)
  })

  it('Följer uses the same post cards and list, from the database (never the loaded posts filtered)', () => {
    expect(section.match(/<PostCard /g)).toHaveLength(1)
    expect(section).toContain('onFollowing.value ? followingFeed(following.posts.value) : feedSort.apply(feed.value)')
    expect(section).not.toMatch(/all\.value\.filter\([^)]*follow/i)
  })

  it('loads when picked, for the sport, and again on coming back; unfollowing removes at once', () => {
    expect(section).toContain("following.load(sport.value === 'alla' ? undefined : sport.value)")
    expect(section).toContain('watch([onFollowing, sport, userId]')
    expect(section).toContain('onMounted(() => onFollowing.value && loadFollowing())')
    expect(section).toContain('following.drop(id)')
  })

  it('has its own honest states: signed out, no name yet, following nobody, nothing posted, failure, paging', () => {
    for (const s of [
      'Logga in för att följa supportrar och se deras inlägg här.',
      'Välj ditt läktarnamn först.',
      'Du följer ingen än.',
      'Inget nytt från dem du följer.',
      'Kunde inte hämta inläggen från dem du följer just nu.',
      'Visa fler',
    ]) expect(section).toContain(s)
    // Following nobody leads back to discovering supporters in Snacket
    expect(section).toContain('@click="sort = \'nyast\'">Visa Nyast')
  })
})
