import type { SourceArticle, Story } from '../shared/types/domain'
import { article } from './helpers'

/*
 * Story grouping regression cases (Issue #25), in our own words, shaped like what the real feeds produced
 * (no feed text is copied). Event labels are ours and certain by construction. Shared by the regression
 * tests and the candidate comparison.
 */

export const at = (hours: number) => new Date(Date.UTC(2026, 10, 1, 10) + hours * 3_600_000).toISOString()
export const original = (over: Partial<SourceArticle> & Pick<SourceArticle, 'headline'>) => article({ outlet: 'Sportbladet', publisher: 'Aftonbladet', reporting: 'original', ...over })
export const compiled = (over: Partial<SourceArticle> & Pick<SourceArticle, 'headline'>) => article({ outlet: 'Bollsvenskan', publisher: 'Bollsvenskan', reporting: 'compiled', ...over })
export const storyOf = (stories: Story[], a: SourceArticle) => stories.find(s => s.sources.some(x => x.id === a.id))!
export const together = (stories: Story[], a: SourceArticle, b: SourceArticle) => storyOf(stories, a) === storyOf(stories, b)

// One transfer, reported by an outlet and summarised by another
export const transfer = [
  original({ headline: 'Klart: Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Mittfältaren har skrivit på för det norska laget.', publishedAt: at(0) }),
  compiled({ headline: 'Berg bekräftar flytten till Vålerenga', excerpt: 'Lina Berg och Vålerenga är överens, uppger Sportbladet.', publishedAt: at(3) }),
]
// One person, one event: the only shared evidence is her full name
export const sacking = [
  compiled({ headline: 'Officiellt: Djurgården sparkar tränaren Jani Mäkinen', excerpt: 'Beslutet togs efter förlusten i helgen.', publishedAt: at(0) }),
  original({ headline: 'Mäkinen om sparken: ”Jag är besviken”', excerpt: 'Jani Mäkinen fick beskedet i morse.', publishedAt: at(4) }),
]
// The same person, two events, the same day: the shared evidence looks exactly like the sacking's
export const twoEvents = [
  compiled({ headline: 'Lina Berg lämnar Djurgården för Vålerenga', excerpt: 'Övergången är klar.', publishedAt: at(0) }),
  original({ headline: 'Lina Berg uttagen till landslaget', excerpt: 'Förbundskaptenen tar ut truppen till novembersamlingen.', publishedAt: at(6) }),
]
// A chain: each neighbour links, the ends are 40 hours and two events apart
export const chain = [
  compiled({ headline: 'Åberg och Lind rasar mot domaren', excerpt: 'Åberg och Lind efter matchen mot Gais.', publishedAt: at(0) }),
  compiled({ headline: 'Lind om skadan: ”Borta i två veckor”', excerpt: 'Lind och Åberg efter Gais-matchen.', publishedAt: at(20) }),
  compiled({ headline: 'Lind tillbaka i träning', excerpt: 'Lind och Åberg tränar igen inför Elfsborg.', publishedAt: at(40) }),
]
// "Energi" opens a sentence in both teasers: an ordinary word, not a name
export const sentenceStart = [
  compiled({ headline: 'Ekdahl om tränarvalet', excerpt: 'Klubben söker en ny tränare. Energi och ledarskap väger tyngst.', publishedAt: at(0) }),
  compiled({ headline: 'Ekdahl inför bortamatchen mot Mjällby', excerpt: 'Laget reser i dag. Energi och fokus, säger han.', publishedAt: at(5) }),
]
export const single = [original({ headline: 'Djurgården förlänger med målvakten Nilsson', excerpt: 'Kontraktet gäller till 2028.', publishedAt: at(0) })]
export const cases = { transfer, sacking, twoEvents, chain, sentenceStart, single }

/*
 * Bridges between two incompatible events (candidate comparison only). A reports a sacking, C a national-team
 * opportunity for the same coach; B links to both by names. A and C must never share a Story through B, and B
 * must not be given to either because of when it was published.
 */
const bridgeEnds = (hours = 12) => [
  compiled({ headline: 'Djurgården sparkar Jani Mäkinen', excerpt: 'Beslutet togs efter förlusten.', publishedAt: at(0) }),
  compiled({ headline: 'Finland vill ha Mäkinen som förbundskapten', excerpt: 'Förbundet har bestämt sig.', publishedAt: at(hours) }),
] as const
/** B of unknown kind, published `hours` after A (C is at 12h). */
export const unknownBridge = (hours = 6) => {
  const [a, c] = bridgeEnds()
  return [a, original({ headline: 'Jani Mäkinen om framtiden', excerpt: 'Jani Mäkinen funderar på Finland.', publishedAt: at(hours) }), c]
}
/** B reports both kinds: the sacked coach is wanted for the national team. */
export const multiKindBridge = () => {
  const [a, c] = bridgeEnds()
  return [a, original({ headline: 'Sparkade Mäkinen lyfts till landslaget', excerpt: 'Jani Mäkinen och Finland.', publishedAt: at(6) }), c]
}
/** Two articles of unknown kind in a row between A and C: neither may be given to an end. */
export const twoStepBridge = () => {
  const [a, c] = bridgeEnds(16)
  return [
    a,
    original({ headline: 'Jani Mäkinen om framtiden', excerpt: 'Jani Mäkinen ser tillbaka, hemma i Helsingfors.', publishedAt: at(5) }),
    compiled({ headline: 'Mäkinen i nytt läge', excerpt: 'Mäkinen syns i Helsingfors, och Finland diskuteras.', publishedAt: at(10) }),
    c,
  ]
}
/** One sacking and its reactions, none of which uses event vocabulary: one Story. */
export const reactions = [
  compiled({ headline: 'Djurgården sparkar Jani Mäkinen', excerpt: 'Beslutet togs efter förlusten.', publishedAt: at(0) }),
  original({ headline: 'Jani Mäkinen: ”Jag är chockad”', excerpt: 'Jani Mäkinen fick beskedet i morse.', publishedAt: at(3) }),
  compiled({ headline: 'Lagkaptenen om Jani Mäkinen: ”En skam”', excerpt: 'Spelarna reagerar på beskedet om Jani Mäkinen.', publishedAt: at(8) }),
]
