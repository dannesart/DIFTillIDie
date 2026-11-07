import type { Sport } from '#shared/types/domain'
import type { LocalOwner } from '~/lib/localScope'
import { readScoped, scopedKey } from '~/lib/localScope'
import type { PostDraft } from '~/lib/postDraft'
import { emptyPostDraft, readPostDraft, startPostDraft, withMention, writePostDraft } from '~/lib/postDraft'

/*
 * Writing happens in one shared dialog (ComposeDialog), in one of two ways:
 *  - about a Story ("Snacka om detta"), with a draft per Story;
 *  - a Snacket post ("Vad snackas det om på stan?"), with one draft: its
 *    text, sport and attached Story.
 * Each keeps its own draft, so an accidental Escape or tap outside never
 * loses what someone was writing. Drafts live only in this browser, like
 * the posts themselves, and per owner: the guest and each signed-in account
 * have their own, and switching account closes the dialog.
 */

const DRAFTS_KEY = 'djurgarn:drafts:v1'

export function useCompose() {
  const activeId = useState<string | null>('compose-story', () => null)
  const drafts = useState<Record<string, string>>('compose-drafts', () => ({}))
  const postOpen = useState('compose-post-open', () => false)
  const post = useState<PostDraft>('compose-post', emptyPostDraft)
  const postResumed = useState('compose-post-resumed', () => false)
  const owner = useState<LocalOwner | null>('compose-drafts-owner', () => null)
  const loaded = useState('compose-drafts-loaded', () => false)
  const authOwner = useLocalOwner()

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    watch(authOwner, (next, prev) => {
      // Someone else now: close a half-written post rather than hand it over.
      if (prev) {
        activeId.value = null
        postOpen.value = false
      }
      owner.value = next
      drafts.value = next ? readScoped<Record<string, string>>(localStorage, scopedKey(DRAFTS_KEY, next), () => ({})) : {}
      post.value = next ? readPostDraft(localStorage, next) : emptyPostDraft()
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

  /** Change the Snacket draft (text, sport or Story), and keep it. */
  function setPost(patch: Partial<PostDraft>) {
    post.value = { ...post.value, ...patch }
    if (owner.value) writePostDraft(localStorage, owner.value, post.value)
  }

  const open = (storyId: string) => {
    postOpen.value = false
    activeId.value = storyId
  }

  /** Write a Snacket post: the draft in progress, or a fresh one from what you're browsing. */
  function openPost(browsing: { sport?: Sport, storyId?: string } = {}, mentioning?: string) {
    activeId.value = null
    // Said in the dialog: text written earlier is still there (not just a mention added now).
    postResumed.value = !!post.value.body.trim()
    const d = startPostDraft(post.value, browsing)
    setPost(mentioning ? { ...d, body: withMention(d.body, mentioning) } : d)
    postOpen.value = true
  }

  /** Reply to someone: their @handle in the Snacket draft, ready to write after. */
  const mention = (handle: string, browsing: { sport?: Sport, storyId?: string } = {}) => openPost(browsing, handle)

  const close = () => {
    activeId.value = null
    postOpen.value = false
  }

  return { activeId, drafts, postOpen, post, postResumed, load, draftFor, setDraft, setPost, open, openPost, mention, close }
}
