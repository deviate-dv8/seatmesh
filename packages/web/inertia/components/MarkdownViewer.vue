<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { markdownNeedsMermaid, renderCardMarkdown } from '~/lib/card-markdown'

const props = withDefaults(
  defineProps<{
    source: string
    /** Document title (optional — page may render its own H1) */
    title?: string
    /** Show sticky TOC for h2/h3 */
    toc?: boolean
    /** Compact = shorter measure; default is mdview reading width */
    compact?: boolean
  }>(),
  { toc: true, compact: false }
)

const bodyEl = ref<HTMLElement | null>(null)
const fullscreenHost = ref<HTMLElement | null>(null)
const fullscreenOpen = ref(false)
const fontScale = ref(1)

type TocItem = { id: string; text: string; level: 2 | 3 }
const tocItems = ref<TocItem[]>([])

const bodyHtml = computed(() => renderCardMarkdown(props.source))
const needsMermaid = computed(() => markdownNeedsMermaid(props.source))
const showToc = computed(() => props.toc && tocItems.value.length >= 2)

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64)
}

function buildToc() {
  if (!bodyEl.value) {
    tocItems.value = []
    return
  }
  const items: TocItem[] = []
  const seen = new Map<string, number>()
  for (const el of bodyEl.value.querySelectorAll('h2, h3')) {
    const level = el.tagName === 'H2' ? 2 : 3
    const text = (el.textContent || '').trim()
    if (!text) continue
    let id = slugify(text) || `h-${items.length}`
    const n = (seen.get(id) || 0) + 1
    seen.set(id, n)
    if (n > 1) id = `${id}-${n}`
    el.id = id
    items.push({ id, text, level })
  }
  tocItems.value = items
}

type PanState = { scale: number; x: number; y: number }

function attachPanZoom(host: HTMLElement, svg: SVGSVGElement): () => void {
  const state: PanState = { scale: 1, x: 0, y: 0 }
  let dragging = false
  let lastX = 0
  let lastY = 0

  function apply() {
    svg.style.transformOrigin = '0 0'
    svg.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const rect = host.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const prev = state.scale
    const next = Math.min(4, Math.max(0.35, prev * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const ratio = next / prev
    state.x = mx - (mx - state.x) * ratio
    state.y = my - (my - state.y) * ratio
    state.scale = next
    apply()
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    host.setPointerCapture(e.pointerId)
    host.classList.add('is-panning')
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    state.x += e.clientX - lastX
    state.y += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    apply()
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false
    host.classList.remove('is-panning')
    try {
      host.releasePointerCapture(e.pointerId)
    } catch {
      /* */
    }
  }

  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerUp)
  host.addEventListener('pointercancel', onPointerUp)
  apply()

  return () => {
    host.removeEventListener('wheel', onWheel)
    host.removeEventListener('pointerdown', onPointerDown)
    host.removeEventListener('pointermove', onPointerMove)
    host.removeEventListener('pointerup', onPointerUp)
    host.removeEventListener('pointercancel', onPointerUp)
  }
}

const cleanups: Array<() => void> = []

function clearCleanups() {
  while (cleanups.length) cleanups.pop()?.()
}

async function runMermaid() {
  clearCleanups()
  if (!needsMermaid.value || !bodyEl.value) return
  const nodes = [...bodyEl.value.querySelectorAll<HTMLElement>('pre.mermaid')]
  if (!nodes.length) return

  const mermaid = (await import('mermaid')).default
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    fontFamily: 'DM Sans, ui-sans-serif, system-ui, sans-serif',
  })

  for (const pre of nodes) {
    if (pre.dataset.mmDone === '1') continue
    try {
      await mermaid.run({ nodes: [pre] })
      pre.dataset.mmDone = '1'
      const svg = pre.querySelector('svg')
      if (!svg) continue

      // Wrap for pan/zoom + chrome
      if (!pre.parentElement?.classList.contains('mm-stage')) {
        const stage = document.createElement('div')
        stage.className = 'mm-stage'
        const toolbar = document.createElement('div')
        toolbar.className = 'mm-toolbar'
        const fsBtn = document.createElement('button')
        fsBtn.type = 'button'
        fsBtn.className = 'mm-tool-btn'
        fsBtn.textContent = 'Fullscreen'
        fsBtn.addEventListener('click', () => openFullscreen(svg))
        toolbar.appendChild(fsBtn)
        const hint = document.createElement('span')
        hint.className = 'mm-hint'
        hint.textContent = 'scroll zoom · drag pan'
        toolbar.appendChild(hint)
        const viewport = document.createElement('div')
        viewport.className = 'mm-viewport'
        pre.parentNode?.insertBefore(stage, pre)
        stage.appendChild(toolbar)
        stage.appendChild(viewport)
        viewport.appendChild(pre)
        cleanups.push(attachPanZoom(viewport, svg))
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 280)
      pre.classList.add('mm-broken')
      pre.textContent = `mermaid broken — fix md:\n${pre.textContent}\n\n(${msg})`
    }
  }
}

function openFullscreen(svg: SVGSVGElement) {
  fullscreenOpen.value = true
  nextTick(() => {
    const host = fullscreenHost.value
    if (!host) return
    host.replaceChildren()
    const clone = svg.cloneNode(true) as SVGSVGElement
    host.appendChild(clone)
    cleanups.push(attachPanZoom(host, clone))
  })
}

function closeFullscreen() {
  fullscreenOpen.value = false
  if (fullscreenHost.value) fullscreenHost.value.replaceChildren()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreenOpen.value) closeFullscreen()
}

async function refresh() {
  await nextTick()
  buildToc()
  await runMermaid()
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await refresh()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  clearCleanups()
})

watch(
  () => props.source,
  async () => {
    await refresh()
  }
)
</script>

<template>
  <div
    class="md-viewer"
    :class="{ 'md-viewer--compact': compact }"
    :style="{ '--md-font-scale': fontScale }"
  >
    <aside v-if="showToc" class="md-viewer__toc" aria-label="On this page">
      <p class="md-viewer__toc-label">On this page</p>
      <nav class="md-viewer__toc-nav">
        <a
          v-for="item in tocItems"
          :key="item.id"
          :href="`#${item.id}`"
          :class="item.level === 3 ? 'is-h3' : 'is-h2'"
        >
          {{ item.text }}
        </a>
      </nav>
    </aside>

    <div class="md-viewer__main">
      <div class="md-viewer__controls" aria-label="Reading controls">
        <button type="button" class="md-ctrl" :disabled="fontScale <= 0.85" @click="fontScale = Math.max(0.85, fontScale - 0.1)">
          A−
        </button>
        <button type="button" class="md-ctrl" :disabled="fontScale >= 1.35" @click="fontScale = Math.min(1.35, fontScale + 0.1)">
          A+
        </button>
      </div>

      <h1 v-if="title" class="md-viewer__title">{{ title }}</h1>

      <article
        ref="bodyEl"
        class="md-viewer__body"
        v-html="bodyHtml"
      />
    </div>

    <Teleport to="body">
      <div v-if="fullscreenOpen" class="mm-fs" role="dialog" aria-modal="true" aria-label="Mermaid fullscreen">
        <div class="mm-fs__bar">
          <span class="mm-hint">scroll zoom · drag pan · Esc</span>
          <button type="button" class="mm-tool-btn" @click="closeFullscreen">Close</button>
        </div>
        <div ref="fullscreenHost" class="mm-fs__viewport" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.md-viewer {
  --md-measure: 42rem;
  --md-ink: #18181b;
  --md-muted: #52525b;
  --md-line: #e4e4e7;
  --md-paper: #ffffff;
  --md-code-bg: #f4f4f5;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  width: 100%;
}

@media (min-width: 1100px) {
  .md-viewer:not(.md-viewer--compact) {
    grid-template-columns: 14rem minmax(0, 1fr);
    gap: 2rem;
  }
}

.md-viewer--compact {
  --md-measure: 36rem;
}

.md-viewer__toc {
  display: none;
}

@media (min-width: 1100px) {
  .md-viewer:not(.md-viewer--compact) .md-viewer__toc {
    display: block;
    position: sticky;
    top: 4.5rem;
    align-self: start;
    max-height: calc(100vh - 5.5rem);
    overflow: auto;
    padding-right: 0.5rem;
  }
}

.md-viewer__toc-label {
  margin: 0 0 0.6rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a1a1aa;
}

.md-viewer__toc-nav {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.md-viewer__toc-nav a {
  color: var(--md-muted);
  text-decoration: none;
  font-size: 0.82rem;
  line-height: 1.35;
  border-left: 2px solid transparent;
  padding-left: 0.65rem;
}

.md-viewer__toc-nav a:hover {
  color: var(--md-ink);
  border-left-color: #22c55e;
}

.md-viewer__toc-nav a.is-h3 {
  padding-left: 1.15rem;
  font-size: 0.78rem;
}

.md-viewer__main {
  max-width: calc(var(--md-measure) + 4rem);
  margin-inline: auto;
  width: 100%;
}

.md-viewer__controls {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1rem;
}

.md-ctrl {
  border: 1px solid var(--md-line);
  background: var(--md-paper);
  border-radius: 0.4rem;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--md-muted);
  cursor: pointer;
}

.md-ctrl:hover:not(:disabled) {
  color: var(--md-ink);
  border-color: #a1a1aa;
}

.md-ctrl:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.md-viewer__title {
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 3vw, 2.35rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 0 0 1.25rem;
  color: var(--md-ink);
  text-wrap: balance;
}

.md-viewer__body {
  font-size: calc(1.05rem * var(--md-font-scale, 1));
  line-height: 1.7;
  color: #3f3f46;
  max-width: var(--md-measure);
}

.md-viewer__body :deep(> :first-child) {
  margin-top: 0;
}

.md-viewer__body :deep(h1),
.md-viewer__body :deep(h2),
.md-viewer__body :deep(h3),
.md-viewer__body :deep(h4) {
  font-family: var(--font-display);
  color: var(--md-ink);
  letter-spacing: -0.02em;
  line-height: 1.25;
  scroll-margin-top: 5rem;
}

.md-viewer__body :deep(h1) {
  font-size: 1.75em;
  margin: 1.4em 0 0.5em;
}
.md-viewer__body :deep(h2) {
  font-size: 1.35em;
  margin: 1.6em 0 0.45em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--md-line);
}
.md-viewer__body :deep(h3) {
  font-size: 1.12em;
  margin: 1.35em 0 0.4em;
}

.md-viewer__body :deep(p),
.md-viewer__body :deep(ul),
.md-viewer__body :deep(ol) {
  margin: 0.85em 0;
}

.md-viewer__body :deep(li + li) {
  margin-top: 0.25em;
}

.md-viewer__body :deep(a) {
  color: #15803d;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.md-viewer__body :deep(a:hover) {
  color: #166534;
}

.md-viewer__body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.86em;
  background: var(--md-code-bg);
  padding: 0.12em 0.35em;
  border-radius: 0.25rem;
}

.md-viewer__body :deep(pre:not(.mermaid)) {
  overflow-x: auto;
  padding: 0.9rem 1rem;
  border-radius: 0.5rem;
  background: #18181b;
  color: #f4f4f5;
  font-size: 0.84em;
  line-height: 1.5;
  margin: 1.1em 0;
}

.md-viewer__body :deep(pre:not(.mermaid) code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

.md-viewer__body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92em;
  margin: 1.1em 0;
  display: block;
  overflow-x: auto;
}

.md-viewer__body :deep(th),
.md-viewer__body :deep(td) {
  border: 1px solid var(--md-line);
  padding: 0.45rem 0.65rem;
  text-align: left;
}

.md-viewer__body :deep(th) {
  background: #fafafa;
  font-weight: 600;
  color: var(--md-ink);
}

.md-viewer__body :deep(blockquote) {
  margin: 1em 0;
  padding: 0.15em 0 0.15em 1em;
  border-left: 3px solid #86efac;
  color: var(--md-muted);
}

.md-viewer__body :deep(hr) {
  border: 0;
  border-top: 1px solid var(--md-line);
  margin: 2em 0;
}

.md-viewer__body :deep(img.md-img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.4rem;
  margin: 1em 0;
}

.md-viewer__body :deep(.mm-stage) {
  margin: 1.25em 0;
  border: 1px solid var(--md-line);
  border-radius: 0.65rem;
  background: #fafafa;
  overflow: hidden;
}

.md-viewer__body :deep(.mm-toolbar) {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid var(--md-line);
  background: #fff;
}

.md-viewer__body :deep(.mm-hint),
.mm-hint {
  font-size: 0.7rem;
  color: #a1a1aa;
  letter-spacing: 0.02em;
}

.md-viewer__body :deep(.mm-tool-btn),
.mm-tool-btn {
  border: 1px solid var(--md-line);
  background: #fff;
  border-radius: 0.35rem;
  padding: 0.2rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: #3f3f46;
  cursor: pointer;
}

.md-viewer__body :deep(.mm-tool-btn:hover),
.mm-tool-btn:hover {
  border-color: #22c55e;
  color: #15803d;
}

.md-viewer__body :deep(.mm-viewport) {
  height: min(420px, 55vh);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background:
    radial-gradient(circle at 1px 1px, #e4e4e7 1px, transparent 0) 0 0 / 16px 16px;
}

.md-viewer__body :deep(.mm-viewport.is-panning) {
  cursor: grabbing;
}

.md-viewer__body :deep(pre.mermaid) {
  margin: 0;
  padding: 1rem;
  background: transparent;
  border: none;
  text-align: center;
  overflow: visible;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
}

.md-viewer__body :deep(pre.mermaid svg) {
  max-width: none;
  height: auto;
}

.md-viewer__body :deep(pre.mermaid.mm-broken) {
  display: block;
  text-align: left;
  white-space: pre-wrap;
  color: #b42318;
  border: 1px solid #e8c5bf;
  padding: 1rem;
  background: #fff6f4;
  font: 0.85rem/1.45 var(--font-mono);
  margin: 1em 0;
}

.mm-fs {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: #fafafa;
  display: flex;
  flex-direction: column;
}

.mm-fs__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--md-line);
  background: #fff;
}

.mm-fs__viewport {
  flex: 1;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 1px 1px, #e4e4e7 1px, transparent 0) 0 0 / 18px 18px;
}

.mm-fs__viewport.is-panning {
  cursor: grabbing;
}

.mm-fs__viewport :deep(svg) {
  max-width: none;
}
</style>
