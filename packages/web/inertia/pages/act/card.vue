<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import MarkdownViewer from '~/components/MarkdownViewer.vue'
import ReaderLayout from '~/layouts/reader.vue'

defineOptions({ layout: ReaderLayout })

type ActLink = { label: string; token: string; url: string }

const props = defineProps<{
  card: {
    id: string
    title: string
    body: string
    links: ActLink[]
    expiresAt: number
  } | null
  daemonPort: number | null
  sessionId: string | null
  daemonCardUrl: string | null
  error?: string
}>()

const actionLinks = computed(() => props.card?.links.filter((l) => l.token) ?? [])
const openLinks = computed(() => props.card?.links.filter((l) => !l.token && l.url) ?? [])
const isRunCmd = computed(
  () =>
    actionLinks.value.some((l) => /^run$/i.test(l.label)) &&
    actionLinks.value.some((l) => /^decline$/i.test(l.label)),
)
const isDecision = computed(() => actionLinks.value.length > 0)

const acting = ref(false)
const actedLabel = ref<string | null>(null)
const actSummary = ref<string | null>(null)
const actOk = ref<boolean | null>(null)

function linkColor(label: string) {
  const t = label.toLowerCase()
  if (t === 'yes' || t === 'ok' || t === 'approve' || t === 'run') return 'primary' as const
  if (t === 'no' || t === 'deny' || t === 'reject' || t === 'decline') return 'neutral' as const
  return 'primary' as const
}

async function fireAct(link: ActLink) {
  if (acting.value || actedLabel.value) return
  acting.value = true
  actSummary.value = null
  actOk.value = null
  try {
    const res = await fetch(link.url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
    let data: { ok?: boolean; label?: string; summary?: string; error?: string } = {}
    try {
      data = (await res.json()) as typeof data
    } catch {
      data = { ok: false, summary: `Bad response (${res.status})` }
    }
    actedLabel.value = data.label || link.label
    actOk.value = Boolean(data.ok)
    actSummary.value = data.summary || data.error || (data.ok ? 'Done.' : 'Action failed.')
  } catch (e) {
    actedLabel.value = link.label
    actOk.value = false
    actSummary.value = (e as Error).message || 'Network error'
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <Head :title="card?.title ?? 'Act card'" />

  <div v-if="!card" class="reader-empty">
    <h1 class="font-display text-2xl font-bold text-zinc-900">Card not found</h1>
    <p class="mt-2 text-sm text-zinc-500">{{ error ?? 'Expired or missing on live daemons.' }}</p>
    <Link href="/notifications" class="mt-4 inline-block text-sm text-primary-700 underline">
      ← Notifications
    </Link>
  </div>

  <div v-else class="reader-doc">
    <p class="reader-kicker">
      {{ isRunCmd ? 'Command · step 2' : isDecision ? 'Decision' : 'Info' }}
      <span v-if="daemonPort" class="sm-num text-zinc-400"> · daemon :{{ daemonPort }}</span>
    </p>

    <MarkdownViewer :source="card.body" :title="card.title" />

    <div
      v-if="actedLabel"
      class="act-result"
      :class="actOk ? 'act-result--ok' : 'act-result--bad'"
      role="status"
    >
      <p class="act-result__label">{{ actedLabel }}</p>
      <p class="act-result__summary">{{ actSummary }}</p>
    </div>

    <footer v-if="(actionLinks.length && !actedLabel) || openLinks.length" class="reader-actions">
      <div v-if="actionLinks.length && !actedLabel" class="flex flex-wrap gap-2">
        <UButton
          v-for="link in actionLinks"
          :key="link.token"
          type="button"
          :color="linkColor(link.label)"
          :variant="/^(no|decline|deny|reject)$/i.test(link.label) ? 'outline' : 'solid'"
          size="md"
          :loading="acting"
          :disabled="acting"
          @click="fireAct(link)"
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
    </footer>
  </div>
</template>

<style scoped>
.reader-empty {
  max-width: 32rem;
  margin: 3rem auto;
  text-align: center;
}

.reader-doc {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.reader-kicker {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #a1a1aa;
}

.act-result {
  max-width: 42rem;
  padding: 1rem 1.15rem;
  border: 1px solid #e4e4e7;
  border-radius: 0.35rem;
  background: #fafafa;
}

.act-result--ok {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.act-result--bad {
  border-color: #fecaca;
  background: #fef2f2;
}

.act-result__label {
  margin: 0;
  font-weight: 650;
  color: #18181b;
}

.act-result__summary {
  margin: 0.35rem 0 0;
  font-size: 0.9rem;
  color: #52525b;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.reader-actions {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: 42rem;
  margin-top: 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid #e4e4e7;
  position: sticky;
  bottom: 0;
  background: linear-gradient(180deg, transparent, #f4f5f7 28%);
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
</style>
