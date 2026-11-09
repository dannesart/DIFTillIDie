import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MatchtipsetRules from '../app/components/MatchtipsetRules.vue'
import { SIXTY_MINUTES } from '../app/lib/matchtips'

/*
 * "Så räknas det" (components/MatchtipsetRules.vue), as the server renders
 * it: the scoring always visible; on a phone the details collapsed behind a
 * real disclosure button; from lg up the details shown. (Expanding is checked
 * in the browser: docs/matchtipset.md, "The supporter UI".)
 */
const render = () => renderToString(createSSRApp(MatchtipsetRules))

describe('Så räknas det', () => {
  it('always shows the scoring summary', async () => {
    const html = await render()
    expect(html).toContain('Så räknas det')
    expect(html.replace(/<[^>]+>/g, '')).toMatch(/3 p exakt.*1 p rätt utgång.*0 p annars/s)
  })

  it('on a phone: collapsed by default, behind a real button that says what it controls', async () => {
    const html = await render()
    const button = html.match(/<button[^>]*>/)![0]
    expect(button).toContain('type="button"')
    expect(button).toContain('aria-expanded="false"')
    expect(button).toMatch(/lg:hidden/)
    const controls = button.match(/aria-controls="([^"]+)"/)![1]
    const details = html.match(new RegExp(`<div id="${controls}"[^>]*>`))![0]
    // Hidden on a phone until expanded; always shown from lg up.
    expect(details).toMatch(/class="[^"]*\bhidden\b[^"]*"/)
    expect(details).toMatch(/class="[^"]*\blg:block\b[^"]*"/)
    expect(html).toContain('Läs hur det räknas')
  })

  it('the details explain the 60-minute rule, the points and the deadline', async () => {
    const html = await render()
    expect(html).toContain(SIXTY_MINUTES)
    expect(html).toContain('Förlängning och straffar räknas inte')
    expect(html).toMatch(/ändra ditt tips fram till matchens deadline, som är nedsläppet/)
    expect(html).toMatch(/Fram till dess ser bara du ditt tips/)
  })
})
