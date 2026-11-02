/*
 * "Djurgår'n i fickan": what we know about installing the app here.
 *
 * - installed:  already running from the home screen (standalone).
 * - canPrompt:  the browser handed us a native install prompt (Chrome, Edge,
 *               Samsung Internet…). We keep it and only use it on a tap.
 * - platform:   decides which Add-to-Home-Screen guidance is accurate.
 *
 * Browser-only state; everything is false/"other" during SSR.
 */

export type InstallPlatform = 'ios-safari' | 'ios-other' | 'ios-inapp' | 'android' | 'desktop' | 'other'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const HINT_KEY = 'djurgarn:install-hint-seen'
const VISITS_KEY = 'djurgarn:visits'
let deferred: BeforeInstallPromptEvent | null = null

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) {
    if (/FBAN|FBAV|Instagram|Line\/|Snapchat|LinkedInApp/i.test(ua)) return 'ios-inapp'
    return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari'
  }
  if (/Android/i.test(ua)) return 'android'
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop'
  return 'other'
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) }
  catch { return null }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) }
  catch { /* private mode: fine, the hint just won't be remembered */ }
}

export function useInstall() {
  const installed = useState('install-installed', () => false)
  const canPrompt = useState('install-can-prompt', () => false)
  const platform = useState<InstallPlatform>('install-platform', () => 'other')
  const visits = useState('install-visits', () => 0)
  const guideOpen = useState('install-guide-open', () => false)

  /** Called once by the pwa plugin on app start. */
  function init() {
    platform.value = detectPlatform()
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    installed.value = standalone

    // Count visits (once per browser session) for the one-time hint.
    let count = Number(readStorage(VISITS_KEY) || 0)
    try {
      if (!sessionStorage.getItem(VISITS_KEY)) {
        sessionStorage.setItem(VISITS_KEY, '1')
        count += 1
        writeStorage(VISITS_KEY, String(count))
      }
    }
    catch { /* sessionStorage blocked: don't count */ }
    visits.value = count

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault() // no automatic mini-infobar; we offer it quietly instead
      deferred = e as BeforeInstallPromptEvent
      canPrompt.value = true
    })
    window.addEventListener('appinstalled', () => {
      installed.value = true
      canPrompt.value = false
      deferred = null
      guideOpen.value = false
    })
  }

  /** Shows the browser's own install dialog. Only ever called from a tap. */
  async function prompt() {
    if (!deferred) return 'unavailable' as const
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    canPrompt.value = false
    return outcome
  }

  /** Can we offer installation at all here, honestly? */
  const supported = computed(() => !installed.value && (canPrompt.value || platform.value === 'ios-safari' || platform.value === 'ios-other' || platform.value === 'ios-inapp' || platform.value === 'android'))

  const hintSeen = () => readStorage(HINT_KEY) === '1'
  const markHintSeen = () => writeStorage(HINT_KEY, '1')

  return { installed, canPrompt, platform, visits, guideOpen, supported, init, prompt, hintSeen, markHintSeen }
}
