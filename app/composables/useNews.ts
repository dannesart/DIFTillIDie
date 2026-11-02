import type { FixturesResponse, NewsResponse, PodcastResponse, SourceArticle, Story } from '#shared/types/domain'

/** Real news from the configured feeds, fetched and grouped on the server. */
export function useNews() {
  const { data, status, error } = useFetch<NewsResponse>('/api/news', {
    key: 'news',
    default: () => ({ stories: [], sources: [], generatedAt: '' }),
  })
  const stories = computed(() => data.value.stories)
  return { news: data, stories, status, error }
}

export function usePodcast() {
  return useFetch<PodcastResponse>('/api/podcast', { key: 'podcast' })
}

export function leadOf(story: Story): SourceArticle {
  return story.sources.find(s => s.id === story.leadId) ?? story.sources[0]!
}

/** Verified upcoming fixtures (football from dif.se's calendar, hockey hand-verified). */
export function useFixtures() {
  return useFetch<FixturesResponse>('/api/fixtures', { key: 'fixtures' })
}
