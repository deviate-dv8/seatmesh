<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import { markdownNeedsMermaid, renderCardMarkdown } from '~/lib/card-markdown'

const props = defineProps<{
  title: string
  body: string
  slug: string
  mesh: string
  sessionId: string
  file: string
}>()

const bodyEl = ref<HTMLElement | null>(null)
const bodyHtml = computed(() => renderCardMarkdown(props.body))
const needsMermaid = computed(() => markdownNeedsMermaid(props.body))

async function runMermaid() {
  if (!needsMermaid.value || !bodyEl.value) return
  const nodes = bodyEl.value.querySelectorAll<HTMLElement>('pre.mermaid')
  if (!nodes.length) return
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
  })
  for (const pre of nodes) {
    try {
      await mermaid.run({ nodes: [pre] })
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 280)
      pre.classList.add('mm-broken')
      pre.textContent = `mermaid broken — fix md:\n${pre.textContent}\n\n(${msg})`
    }
  }
}

onMounted(async () => {
  await nextTick()
  await runMermaid()
})

watch(
  () => props.slug,
  async () => {
    await nextTick()
    await runMermaid()
  }
)
</script>

<template>
  <Head :title="title" />

  <Link href="/mds" class="mb-3 inline-flex text-sm text-zinc-500 hover:text-primary-700">
    ← Hosted MDs
  </Link>

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">{{ title }}</h1>
    <p class="mt-1 text-xs text-zinc-500" translate="no">
      {{ mesh }} · {{ file }} · {{ slug }}
    </p>
  </header>

  <article
    ref="bodyEl"
    class="sm-panel hosted-md px-5 py-4 prose prose-zinc max-w-none"
    v-html="bodyHtml"
  />
</template>

<style scoped>
.hosted-md :deep(pre.mermaid) {
  background: transparent;
  overflow-x: auto;
}
.hosted-md :deep(pre.mermaid.mm-broken) {
  color: #b91c1c;
  white-space: pre-wrap;
  font-size: 0.8rem;
}
.hosted-md :deep(pre:not(.mermaid)) {
  overflow-x: auto;
}
.hosted-md :deep(img.md-img) {
  max-width: 100%;
  height: auto;
}
</style>
