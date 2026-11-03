import type { LocalOwner } from '~/lib/localScope'
import { readScoped, scopedKey } from '~/lib/localScope'

/*
 * Writing about a Story happens in one shared dialog. This holds which
 * Story it's open for, and a draft per Story, so an accidental Escape or
 * tap outside never loses what someone was writing. Drafts live only in
 * this browser, like the posts themselves, and per owner: the guest and
 * each signed-in account have their own.
 */

const DRAFTS_KEY = 'djurgarn:drafts:v1'

export function useStoryCompose() {
  const activeId = useState<string | null>('compose-story', () => null)
  const drafts = useState<Record<string, string>>('compose-drafts', () => ({}))
  const owner = useState<LocalOwner | null>('compose-drafts-owner', () => null)
  const loaded = useState('compose-drafts-loaded', () => false)
  const authOwner = useLocalOwner()

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    watch(authOwner, (next, prev) => {
      // Someone else now: close a half-written Story rather than hand it over.
      if (prev) activeId.value = null
      owner.value = next
      drafts.value = next ? readScoped<Record<string, string>>(localStorage, scopedKey(DRAFTS_KEY, next), () => ({})) : {}
    }, { immediate: true })
  }

  function save() {
    if (!owner.value) return
    try { localStorage.setItem(scopedKey(DRAFTS_KEY, owner.value), JSON.stringify(drafts.value)) }
    catch { /* storage full or blocked */ }
  }

  const draftFor = (storyId: string) => drafts.value[storyId] ?? ''

  function setDraft(storyId: string, text: string) {
    if (text.trim()) drafts.value[storyId] = text
    else delete drafts.value[storyId]
    save()
  }

  const open = (storyId: string) => (activeId.value = storyId)
  const close = () => (activeId.value = null)

  return { activeId, drafts, load, draftFor, setDraft, open, close }
}
