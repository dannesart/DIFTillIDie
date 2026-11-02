import type { Post, PostAuthor, PostComment, ReactionKey } from '#shared/types/domain'

/*
 * DEMO CONTENT. Every supporter, handle and post here is invented.
 */

const people = {
  kaminen: { name: 'Lotta från Gärdet', handle: 'kaminen81', flair: 'Säsongskort sedan 1998' },
  hovet: { name: 'Hovet-Hasse', handle: 'hovethasse', flair: 'Hockey, alltid hockey' },
  osby: { name: 'Mira Östberg', handle: 'miraost', flair: 'Bortaresenär' },
  tifo: { name: 'Tifo-Tobbe', handle: 'tifotobbe', flair: 'Tyg & tejp' },
  nyfiken: { name: 'Sami K', handle: 'samik', flair: 'Första säsongen på läktaren' },
  farfar: { name: 'Farfar Bengt', handle: 'bengt1955', flair: 'Råsunda-veteran' },
  stats: { name: 'xG-Ylva', handle: 'xgylva', flair: 'Siffror och känslor' },
} satisfies Record<string, PostAuthor>

type Seed = Omit<Post, 'createdAt' | 'comments' | 'demo' | 'reactions'> & {
  minutesAgo: number
  reactions: Partial<Record<ReactionKey, number>>
  comments?: (Omit<PostComment, 'createdAt'> & { minutesAgo: number })[]
}

const seeds: Seed[] = [
  {
    id: 'p1', author: people.kaminen, minutesAgo: 22, sport: 'fotboll', storyId: 'derbybiljetterna',
    body: 'Satt med tre flikar uppe och ändå kön på 14 000. Men jag är med! Vem mer står på Sofialäktaren? @tifotobbe säg att ni behöver folk på fredag #derby',
    reactions: { hjarta: 84, eld: 41, stjarna: 6, tarar: 3 },
    comments: [
      { id: 'c1', author: people.tifo, body: 'Fredag 18.00, ta med varma kläder och bra humör 💙', minutesAgo: 15 },
      { id: 'c2', author: people.nyfiken, body: 'Fick ingen biljett 😭 Någon som vet om det släpps fler?', minutesAgo: 9 },
    ],
  },
  {
    id: 'p2', author: people.hovet, minutesAgo: 95, sport: 'hockey', storyId: 'hovet-comeback',
    body: 'Jag har gått på Hovet i trettio år och har aldrig hört det så högt som när trean satt. Taket lyfte. Jag lovar. #hovet',
    reactions: { hjarta: 132, eld: 98, stjarna: 21, tarar: 2 },
    comments: [
      { id: 'c3', author: people.farfar, body: 'Det var som -89. Jag var där då också.', minutesAgo: 80 },
    ],
  },
  {
    id: 'p3', author: people.nyfiken, minutesAgo: 6,
    body: 'Fråga från en nybörjare: var ska man stå om man vill sjunga men inte riskera att bli nedtrampad? 😅',
    reactions: { hjarta: 19, eld: 0, stjarna: 4, tarar: 0 },
    comments: [
      { id: 'c4', author: people.kaminen, body: 'Kom till oss, @samik! Vi tar hand om nya. Ses vid korvkiosken innan.', minutesAgo: 3 },
    ],
  },
  {
    id: 'p4', author: people.stats, minutesAgo: 210, sport: 'fotboll', storyId: 'nordqvist-a-truppen',
    body: 'Nordqvist har flest progressiva passningar i hela J-allsvenskan i år (påhittad siffra, men känslan är äkta). Ge honom minuter! #akademin',
    reactions: { hjarta: 56, eld: 33, stjarna: 12, tarar: 0 },
    comments: [],
  },
  {
    id: 'p5', author: people.tifo, minutesAgo: 380, storyId: 'tifo-volontarer',
    body: 'Status från verkstaden: 212 av 400 meter klart. Vi behöver fler som kan hålla en pensel rakt. Fika bjuder vi på. #tifo',
    reactions: { hjarta: 77, eld: 12, stjarna: 30, tarar: 0 },
    comments: [
      { id: 'c5', author: people.osby, body: 'Jag kommer på söndag! Kan inte måla men kan bära.', minutesAgo: 300 },
      { id: 'c6', author: people.farfar, body: 'Jag tar med kanelbullar.', minutesAgo: 290 },
    ],
  },
  {
    id: 'p6', author: people.osby, minutesAgo: 47, sport: 'fotboll',
    body: 'Bortaresan till Göteborg: buss går 07.00 från Cityterminalen. 12 platser kvar. Skriv här så samordnar vi. #borta',
    reactions: { hjarta: 23, eld: 9, stjarna: 3, tarar: 0 },
    comments: [],
  },
  {
    id: 'p7', author: people.farfar, minutesAgo: 1440,
    body: 'Mitt barnbarn frågade varför jag fortfarande går på matcherna efter alla år. Jag sa: för att det är blårandigt. Mer behövde inte sägas.',
    reactions: { hjarta: 241, eld: 10, stjarna: 44, tarar: 18 },
    comments: [
      { id: 'c7', author: people.hovet, body: 'Bengt för president.', minutesAgo: 1300 },
    ],
  },
  {
    id: 'p8', author: people.hovet, minutesAgo: 600, sport: 'hockey', storyId: 'hockey-trojan',
    body: 'Fick tag på den sista XL:en på Hovet. Den sitter som en dröm. @kaminen81 du får låna den till derbyt (nej).',
    reactions: { hjarta: 38, eld: 15, stjarna: 2, tarar: 6 },
    comments: [],
  },
]

export function buildDemoPosts(now: number): Post[] {
  const at = (m: number) => new Date(now - m * 60_000).toISOString()
  return seeds.map(({ minutesAgo, reactions, comments = [], ...post }) => ({
    ...post,
    createdAt: at(minutesAgo),
    reactions: { hjarta: 0, eld: 0, stjarna: 0, tarar: 0, ...reactions },
    comments: comments.map(({ minutesAgo: m, ...c }) => ({ ...c, createdAt: at(m) })),
    demo: true,
  }))
}
