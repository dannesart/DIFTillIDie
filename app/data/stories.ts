import type { SourceArticle, Story } from '#shared/types/domain'

/*
 * DEMO CONTENT.
 * Every outlet, headline, person and link below is invented so we can explore
 * the experience. Outlets are fictional on purpose: we never put made-up
 * headlines in a real newsroom's mouth. Links go to example.com.
 */

type Seed = Omit<Story, 'updatedAt' | 'sources' | 'demo'> & {
  sources: (Omit<SourceArticle, 'publishedAt' | 'demo' | 'url'> & { minutesAgo: number })[]
}

const seeds: Seed[] = [
  {
    id: 'derbybiljetterna',
    sport: 'fotboll',
    kicker: 'Derbyt',
    title: 'Biljettsläppet inför derbyt mot AIK',
    about: 'Hur biljetterna till höstens derby på Tele2 Arena fördelades, och vad supportrar och klubb säger om det.',
    sources: [
      { id: 'kvallsekot-derby', outlet: 'Kvällsekot', headline: 'Slutsålt på 41 minuter – derbyfebern är tillbaka', format: 'nyhet', minutesAgo: 38 },
      { id: 'ostrasport-derby', outlet: 'Östra Sport', headline: 'Klubben utreder om en extra sektion kan öppnas', format: 'nyhet', minutesAgo: 72 },
      { id: 'laktarbloggen-derby', outlet: 'Läktarbloggen', headline: 'Ge medlemmarna förtur – det är vi som står där i regnet i mars', format: 'krönika', minutesAgo: 140 },
    ],
  },
  {
    id: 'hovet-comeback',
    sport: 'hockey',
    kicker: 'Hovet',
    title: 'Vändningen mot Färjestad i tredje perioden',
    about: 'Matchen på Hovet där Djurgården låg under med två mål inför sista perioden.',
    sources: [
      { id: 'sportlinjen-hovet', outlet: 'Sportlinjen', headline: 'Tre mål på sju minuter: ”Hovet bar oss”', format: 'nyhet', minutesAgo: 95 },
      { id: 'gardesposten-hovet', outlet: 'Gärdesposten', headline: 'Analys: Powerplay-justeringen som vände allt', format: 'analys', minutesAgo: 180 },
    ],
  },
  {
    id: 'nordqvist-a-truppen',
    sport: 'fotboll',
    kicker: 'Akademin',
    title: 'Elias Nordqvist, 19, i A-truppen',
    about: 'En fiktiv mittfältare från den egna akademin som flyttas upp till A-laget.',
    sources: [
      { id: 'ostrasport-nordqvist', outlet: 'Östra Sport', headline: 'Nordqvist uppflyttad: ”Har drömt om det här sedan jag var sju”', format: 'intervju', minutesAgo: 260 },
      { id: 'stadenssport-nordqvist', outlet: 'Stadens Sport', headline: 'Akademins nästa namn – så spelar Elias Nordqvist', format: 'analys', minutesAgo: 320 },
      { id: 'kvallsekot-nordqvist', outlet: 'Kvällsekot', headline: 'Klart: 19-åringen skriver A-lagskontrakt', format: 'notis', minutesAgo: 410 },
    ],
  },
  {
    id: 'tifo-volontarer',
    sport: 'klubben',
    kicker: 'Läktaren',
    title: 'Tifo-bygget inför säsongspremiären',
    about: 'Supportrar som bygger tifot inför premiären och söker fler händer.',
    sources: [
      { id: 'laktarbloggen-tifo', outlet: 'Läktarbloggen', headline: '400 meter tyg och en lada på Lidingö – inne i tifo-verkstaden', format: 'nyhet', minutesAgo: 500 },
    ],
  },
  {
    id: 'hockey-trojan',
    sport: 'hockey',
    kicker: 'Merch',
    title: 'Den nya jubileumströjan',
    about: 'Hockeylagets jubileumströja och efterfrågan på den.',
    sources: [
      { id: 'sportlinjen-trojan', outlet: 'Sportlinjen', headline: 'Jubileumströjan slut i flera storlekar efter ett dygn', format: 'notis', minutesAgo: 610 },
      { id: 'gardesposten-trojan', outlet: 'Gärdesposten', headline: 'Krönika: Varför en tröja kan betyda allt', format: 'krönika', minutesAgo: 700 },
    ],
  },
  {
    id: 'grasmattan',
    sport: 'fotboll',
    kicker: 'Arenan',
    title: 'Underlaget på Tele2 Arena inför våren',
    about: 'Diskussionen om gräs, hybridgräs och konstgräs på hemmaarenan.',
    sources: [
      { id: 'stadenssport-gras', outlet: 'Stadens Sport', headline: 'Arenabolaget svarar om gräsfrågan', format: 'nyhet', minutesAgo: 900 },
      { id: 'kvallsekot-gras', outlet: 'Kvällsekot', headline: 'Spelarna om underlaget: ”Vi vill ha riktigt gräs”', format: 'intervju', minutesAgo: 980 },
    ],
  },
]

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function buildDemoStories(now: number): Story[] {
  return seeds.map((seed) => {
    const sources: SourceArticle[] = seed.sources.map(({ minutesAgo, ...s }) => ({
      ...s,
      url: `https://example.com/demo/${slug(s.outlet)}/${s.id}`,
      publishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
      demo: true,
    }))
    const newest = Math.min(...seed.sources.map(s => s.minutesAgo))
    return {
      ...seed,
      sources,
      updatedAt: new Date(now - newest * 60_000).toISOString(),
      demo: true,
    }
  })
}
