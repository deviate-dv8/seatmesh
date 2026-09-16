<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Head } from '@inertiajs/vue3'
import { markdownNeedsMermaid, renderCardMarkdown } from '~/lib/card-markdown'

const props = defineProps<{
  card: {
    id: string
    title: string
    body: string
    links: Array<{ label: string; token: string; url: string }>
    expiresAt: number
  } | null
  daemonPort: number | null
  sessionId: string | null
  daemonCardUrl: string | null
  error?: string
}>()

const bodyEl = ref<HTMLElement | null>(null)

const actionLinks = computed(() => props.card?.links.filter((l) => l.token) ?? [])
const openLinks = computed(() => props.card?.links.filter((l) => !l.token && l.url) ?? [])
const isDecision = computed(() => actionLinks.value.length > 0)
const bodyHtml = computed(() => (props.card?.body ? renderCardMarkdown(props.card.body) : ''))
const needsMermaid = computed(() => markdownNeedsMermaid(props.card?.body ?? ''))

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
  () => props.card?.id,
  async () => {
    await nextTick()
    await runMermaid()
  }
)

function linkColor(label: string) {
  const t = label.toLowerCase()
  if (t === 'yes' || t === 'ok' || t === 'approve') return 'primary' as const
  if (t === 'no' || t === 'deny' || t === 'reject') return 'neutral' as const
  return 'primary' as const
}
</script>

<template>
  <Head :title="card?.title ?? 'Act card'" />

  <UButton v-if="sessionId" :to="`/sessions/${sessionId}`" color="neutral" variant="ghost" size="sm" class="-ml-2 mb-2">
    ← Session
  </UButton>
  <UButton v-else to="/notifications" color="neutral" variant="ghost" size="sm" class="-ml-2 mb-2">
    ← Notifications
  </UButton>

  <div v-if="!card" class="sm-panel px-6 py-10 text-center">
    <h1 class="font-display text-2xl font-bold text-zinc-900">Card not found</h1>
    <p class="mt-2 text-sm text-zinc-500">{{ error ?? 'Expired or missing on live daemons.' }}</p>
  </div>

  <article v-else class="sm-panel overflow-hidden">
    <header class="border-b border-zinc-100 px-4 py-4 sm:px-5">
      <p class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {{ isDecision ? 'Decision card' : 'Info card' }}
      </p>
      <h1 class="font-display mt-1 text-2xl font-bold tracking-tight text-zinc-900 text-balance">
        {{ card.title }}
      </h1>
      <p v-if="daemonPort" class="mt-1 text-xs text-zinc-400 sm-num" translate="no">
        via hub · daemon :{{ daemonPort }} · expires {{ new Date(card.expiresAt).toLocaleString() }}
      </p>
    </header>
    <div
      ref="bodyEl"
      class="act-card-md prose prose-sm max-w-none px-4 py-4 sm:px-5 text-zinc-700 break-words"
      v-html="bodyHtml"
    />
    <footer class="flex flex-col gap-3 border-t border-zinc-100 px-4 py-4 sm:px-5">
      <div v-if="actionLinks.length" class="flex flex-wrap gap-2">
        <UButton
          v-for="link in actionLinks"
          :key="link.token"
          :to="link.url"
          external
          :color="linkColor(link.label)"
          :variant="link.label.toLowerCase() === 'no' ? 'outline' : 'solid'"
          size="md"
        >
          {{ link.label }}
        </UButton>
      </div>
      <div v-if="openLinks.length" class="flex flex-wrap gap-2">
        <UButton
          v-for="(link, i) in openLinks"
          :key="`open-${i}`"
          :to="link.url"
          external
          target="_blank"
          color="neutral"
          variant="soft"
          size="sm"
        >
          {{ link.label || 'Open' }}
        </UButton>
      </div>
      <p v-if="daemonCardUrl" class="text-xs text-zinc-400">
        Fallback:
        <a :href="daemonCardUrl" class="underline hover:text-zinc-600" translate="no">daemon local card</a>
      </p>
    </footer>
  </article>
</template>

<style scoped>
.act-card-md :deep(pre.mermaid) {
  background: transparent;
  border: none;
  margin: 0.75rem 0;
  padding: 0;
  text-align: center;
  overflow: visible;
}
.act-card-md :deep(pre.mermaid.mm-broken) {
  text-align: left;
  white-space: pre-wrap;
  color: #b42318;
  border: 1px solid #e8c5bf;
  padding: 1rem;
  background: #fff6f4;
  font: 0.9rem/1.45 ui-monospace, monospace;
}
.act-card-md :deep(img.md-img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.375rem;
}
.act-card-md :deep(pre:not(.mermaid)) {
  overflow-x: auto;
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: #f4f4f5;
  font-size: 0.85em;
}
</style>
