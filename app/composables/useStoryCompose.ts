/*
 * Writing about a Story happens in one shared dialog. This holds which
 * Story it's open for, and a draft per Story, so an accidental Escape or
 * tap outside never loses what someone was writing. Drafts live only in
 * this browser, like the posts themselves.
 */

const DRAFTS_KEY = 'djurgarn:drafts:v1'

export function useStoryCompose() {
  const activeId = useState<string | null>('compose-story', () => null)
  const drafts = useState<Record<string, string>>('compose-drafts', () => ({}))
  const loaded = useState('compose-drafts-loaded', () => false)

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(DRAFTS_KEY)
      if (raw) drafts.value = JSON.parse(raw)
    }
    catch { /* private mode or corrupt data: start fresh */ }
    watch(drafts, (v) => {
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(v)) }
      catch { /* storage full or blocked */ }
    }, { deep: true })
  }

  const draftFor = (storyId: string) => drafts.value[storyId] ?? ''

  function setDraft(storyId: string, text: string) {
    if (text.trim()) drafts.value[storyId] = text
    else delete drafts.value[storyId]
  }

  const open = (storyId: string) => (activeId.value = storyId)
  const close = () => (activeId.value = null)

  return { activeId, drafts, load, draftFor, setDraft, open, close }
}
