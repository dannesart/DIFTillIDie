import type { Sport, Story } from '#shared/types/domain'
import type { LocalOwner } from '~/lib/localScope'
import type { PostDraft } from '~/lib/postDraft'
import { discardPostDraft, emptyPostDraft, readPostDraft, startPostDraft, withMention, writePostDraft } from '~/lib/postDraft'
import type { StoryDraft } from '~/lib/storyDrafts'
import { readStoryDrafts, removeStoryDraft, saveStoryDraft, STORY_DRAFTS_KEY, STORY_DRAFTS_V1_KEY } from '~/lib/storyDrafts'

/*
 * Writing happens in one shared dialog (ComposeDialog), in one of two ways:
 *  - about a Story ("Snacka om detta"): a Story draft, each one a draft of
 *    its own (lib/storyDrafts), found again by the article it's about;
 *  - a Snacket post ("Vad snackas det om på stan?"), with one draft: its
 *    text, sport and attached Story.
 * The dialog also lists Story drafts to choose from ("Sparade utkast").
 * Each draft is kept on its own, so an accidental Escape or tap outside never
 * loses what someone was writing, and continuing one never touches another.
 * Drafts live only in this browser, like the posts themselves, and per
 * owner: the guest and each signed-in account have their own, and switching
 * account closes the dialog.
 */

export function useCompose() {
  const storyDrafts = useState<StoryDraft[]>('compose-story-drafts', () => [])
  /** The Story draft open in the dialog; a new one isn't kept until it has text. */
  const active = useState<StoryDraft | null>('compose-story-draft', () => null)
  /** The dialog's list of Story drafts: all, or those about one Story. */
  const listing = useState<{ storyId?: string } | null>('compose-draft-list', () => null)
  /** Where an open Story draft was chosen from, to go back to. */
  const listedFrom = useState<{ storyId?: string } | null>('compose-draft-from', () => null)
  const postOpen = useState('compose-post-open', () => false)
  const post = useState<PostDraft>('compose-post', emptyPostDraft)
  const postResumed = useState('compose-post-resumed', () => false)
  const owner = useState<LocalOwner | null>('compose-drafts-owner', () => null)
  const loaded = useState('compose-drafts-loaded', () => false)
  const authOwner = useLocalOwner()

  const reread = () => (storyDrafts.value = owner.value ? readStoryDrafts(localStorage, owner.value) : [])

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    watch(authOwner, (next, prev) => {
      // Someone else now: close a half-written post rather than hand it over.
      if (prev) close()
      owner.value = next
      reread()
      post.value = next ? readPostDraft(localStorage, next) : emptyPostDraft()
    }, { immediate: true })
    // Drafts kept in another tab show up here too.
    window.addEventListener('storage', (e) => {
      if (e.key?.startsWith(STORY_DRAFTS_KEY) || e.key?.startsWith(STORY_DRAFTS_V1_KEY)) reread()
    })
  }

  /** Change the open Story draft, and keep it: that draft only. */
  function setStoryDraft(patch: Partial<StoryDraft>) {
    if (!active.value) return
    active.value = { ...active.value, ...patch }
    if (!owner.value) return
    // Kept: carry on with it as kept (an old draft has an id of its own from now on). Not: it stays as typed.
    const kept = saveStoryDraft(localStorage, owner.value, active.value)
    if (kept) active.value = kept
    reread()
  }

  /** The open Story draft, published or thrown away: removed, and only it. */
  function removeActive() {
    if (active.value && owner.value) removeStoryDraft(localStorage, owner.value, active.value)
    reread()
  }

  /** Change the Snacket draft (text, sport or Story), and keep it. */
  function setPost(patch: Partial<PostDraft>) {
    post.value = { ...post.value, ...patch }
    if (owner.value) writePostDraft(localStorage, owner.value, post.value)
  }

  /** Write in one Story draft: one chosen by the supporter, or a new one about a Story (newStoryDraft). */
  function openDraft(d: StoryDraft) {
    listedFrom.value = listing.value
    postOpen.value = false
    listing.value = null
    active.value = d
  }

  /** Choose among the Story drafts: all of them, or those about one Story. */
  function openDrafts(storyId?: string) {
    postOpen.value = false
    active.value = null
    listedFrom.value = null
    listing.value = { storyId }
  }

  /** Write a Snacket post: the draft in progress, or a fresh one from what you're browsing. */
  function openPost(browsing: { sport?: Sport, story?: Story } = {}, mentioning?: string) {
    active.value = null
    listing.value = null
    // Said in the dialog: text written earlier is still there (not just a mention added now).
    postResumed.value = !!post.value.body.trim()
    const d = startPostDraft(post.value, browsing)
    setPost(mentioning ? { ...d, body: withMention(d.body, mentioning) } : d)
    postOpen.value = true
  }

  /** Reply to someone: their @handle in the Snacket draft, ready to write after. */
  const mention = (handle: string, browsing: { sport?: Sport, story?: Story } = {}) => openPost(browsing, handle)

  /**
   * Throw the Snacket draft away (text and Story; the sport stays), here and
   * in this account's storage. Other accounts' drafts and the Story drafts
   * are untouched.
   */
  const discardPost = () => setPost(discardPostDraft(post.value))

  const close = () => {
    active.value = null
    listing.value = null
    listedFrom.value = null
    postOpen.value = false
  }

  return { storyDrafts, active, listing, listedFrom, postOpen, post, postResumed, load, setStoryDraft, removeActive, setPost, discardPost, openDraft, openDrafts, openPost, mention, close }
}
