import type { Sport, StorySport } from '#shared/types/domain'
import { buildDemoStories } from '~/data/stories'
import { buildDemoFixtures } from '~/data/fixtures'

/**
 * The moment demo content is anchored to. Created once on the server and
 * serialized to the client, so relative timestamps line up after hydration.
 */
export function useDemoNow() {
  return useState('demo-now', () => Date.now())
}

/** Live clock, ticking only in the browser. `null` until mounted. */
export function useNow(interval = 1000) {
  const now = ref<number | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    now.value = Date.now()
    timer = setInterval(() => (now.value = Date.now()), interval)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return now
}

export type SportFilter = 'alla' | Sport

export function useSport() {
  const sport = useState<SportFilter>('sport', () => 'alla')
  const matches = (s?: StorySport) => sport.value === 'alla' || !s || s === 'klubben' || s === sport.value
  return { sport, matches }
}

export function useStories() {
  const now = useDemoNow()
  return useState('stories', () => buildDemoStories(now.value))
}

export function useFixtures() {
  const now = useDemoNow()
  return useState('fixtures', () => buildDemoFixtures(now.value))
}

/** Scroll to a Story and make it glow for a moment. */
export function useStorySpotlight() {
  const spotlight = useState<string | null>('story-spotlight', () => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  function show(id: string) {
    document.getElementById(`story-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    spotlight.value = id
    clearTimeout(timer)
    timer = setTimeout(() => (spotlight.value = null), 2400)
  }
  return { spotlight, show }
}
