import type { FixturesResponse, NewsResponse, PodcastsResponse, SourceArticle, Story } from '#shared/types/domain'

/** Real news from the configured feeds, fetched and grouped on the server. */
export function useNews() {
  const { data, status, error } = useFetch<NewsResponse>('/api/news', {
    key: 'news',
    default: () => ({ stories: [], sources: [], generatedAt: '' }),
  })
  const stories = computed(() => data.value.stories)
  return { news: data, stories, status, error }
}

/** All podcasts in "Lyssna & titta", each with its own status. */
export function usePodcasts() {
  return useFetch<PodcastsResponse>('/api/podcast', { key: 'podcasts', default: () => ({ shows: [] }) })
}

export function leadOf(story: Story): SourceArticle {
  return story.sources.find(s => s.id === story.leadId) ?? story.sources[0]!
}

/** Verified upcoming fixtures (football from dif.se's calendar, hockey hand-verified). */
export function useFixtures() {
  return useFetch<FixturesResponse>('/api/fixtures', { key: 'fixtures' })
}
