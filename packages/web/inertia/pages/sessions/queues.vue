<script setup lang="ts">
import { onMounted } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'
import { useAbortableReload } from '~/composables/useAbortable'

const props = defineProps<{
  id: string
  error: string | null
  pollMs?: number
  session: {
    id: string
    label: string
    daemonPort: number
    daemonUp: boolean | null
    health: Record<string, unknown> | null
  }
  queues: {
    acks: Array<Record<string, unknown>>
    checkbacks: Array<Record<string, unknown>>
    inbox: Array<Record<string, unknown>>
    paneOps: Array<Record<string, unknown>>
  }
}>()

const { start: startPoll } = useAbortableReload({
  only: ['queues', 'error', 'session'],
  intervalMs: props.pollMs ?? 10000,
})

onMounted(() => startPoll())

function cancelCb(cbId: string) {
  router.post(`/sessions/${props.session.id}/queues/cb/${encodeURIComponent(cbId)}/cancel`, {}, {
    preserveScroll: true,
  })
}

function resolveItem(itemId: string) {
  router.post(
    `/sessions/${props.session.id}/queues/inbox/${encodeURIComponent(itemId)}/resolve`,
    {},
    { preserveScroll: true }
  )
}

function clearAcks() {
  router.post(`/sessions/${props.session.id}/queues/ack/clear`, {}, { preserveScroll: true })
}

function fmtWhen(iso: unknown) {
  if (!iso || typeof iso !== 'string') return '—'
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
</script>

<template>
  <Head :title="`Queues · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="queues"
  />

  <header class="mb-4">
    <h1 class="font-display text-3xl font-bold tracking-tight">Queues</h1>
    <p class="mt-1 text-muted">
      Live <code class="sm-mono">/ack</code> · <code class="sm-mono">/patience</code> ·
      <code class="sm-mono">/inbox</code> · <code class="sm-mono">/pane-ops</code>
    </p>
  </header>

  <UAlert v-if="error" color="error" variant="subtle" class="mb-4" :title="error" />

  <div class="grid gap-4">
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold">Open ACKs ({{ queues.acks.length }})</h2>
          <UButton
            v-if="queues.acks.length"
            size="xs"
            color="neutral"
            variant="outline"
            @click="clearAcks"
          >
            Clear All
          </UButton>
        </div>
      </template>
      <div v-if="queues.acks.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2.5 font-semibold">Seat</th>
              <th class="px-4 py-2.5 font-semibold">Ask</th>
              <th class="px-4 py-2.5 font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queues.acks" :key="String(row.id)" class="border-t border-default">
              <td class="px-4 py-2.5" translate="no">{{ row.seat || row.to || '—' }}</td>
              <td class="px-4 py-2.5 break-words">{{ row.ask || row.summary || row.id }}</td>
              <td class="px-4 py-2.5 sm-num whitespace-nowrap">{{ fmtWhen(row.at || row.openedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="p-6 text-center text-muted">No open ACKs.</p>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <h2 class="font-semibold">Checkbacks ({{ queues.checkbacks.length }})</h2>
      </template>
      <div v-if="queues.checkbacks.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2.5 font-semibold">Expect</th>
              <th class="px-4 py-2.5 font-semibold">Kind</th>
              <th class="px-4 py-2.5 font-semibold">Expires</th>
              <th class="px-4 py-2.5 font-semibold"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queues.checkbacks" :key="String(row.id)" class="border-t border-default">
              <td class="px-4 py-2.5 break-words">{{ row.expect || row.id }}</td>
              <td class="px-4 py-2.5">{{ row.kind || '—' }}</td>
              <td class="px-4 py-2.5 sm-num whitespace-nowrap">{{ fmtWhen(row.expiresAt || row.exp) }}</td>
              <td class="px-4 py-2.5 text-right">
                <UButton size="xs" color="error" variant="ghost" @click="cancelCb(String(row.id))">
                  Cancel
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="p-6 text-center text-muted">No checkbacks.</p>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <h2 class="font-semibold">Inbox ({{ queues.inbox.length }})</h2>
      </template>
      <div v-if="queues.inbox.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2.5 font-semibold">From</th>
              <th class="px-4 py-2.5 font-semibold">Body</th>
              <th class="px-4 py-2.5 font-semibold"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queues.inbox" :key="String(row.id)" class="border-t border-default">
              <td class="px-4 py-2.5" translate="no">{{ row.from || '—' }}</td>
              <td class="px-4 py-2.5 break-words">{{ row.body || row.summary || row.id }}</td>
              <td class="px-4 py-2.5 text-right">
                <UButton
                  v-if="row.id"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  @click="resolveItem(String(row.id))"
                >
                  Resolve
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="p-6 text-center text-muted">Inbox clear.</p>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <h2 class="font-semibold">Pane-ops ({{ queues.paneOps.length }})</h2>
      </template>
      <div v-if="queues.paneOps.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2.5 font-semibold">Kind</th>
              <th class="px-4 py-2.5 font-semibold">Who</th>
              <th class="px-4 py-2.5 font-semibold">Summary</th>
              <th class="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in queues.paneOps.slice(0, 40)" :key="String(row.id)" class="border-t border-default">
              <td class="px-4 py-2.5">{{ row.kind || '—' }}</td>
              <td class="px-4 py-2.5" translate="no">{{ row.who || row.target || '—' }}</td>
              <td class="px-4 py-2.5 break-words">{{ row.summary || '—' }}</td>
              <td class="px-4 py-2.5">{{ row.status || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="p-6 text-center text-muted">No pane-ops.</p>
    </UCard>
  </div>
</template>
