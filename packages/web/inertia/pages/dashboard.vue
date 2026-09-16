<script setup lang="ts">
import { onMounted } from 'vue'
import { Head } from '@inertiajs/vue3'
import SeatmeshMark from '~/components/SeatmeshMark.vue'
import { useAbortableReload } from '~/composables/useAbortable'
import { useInboxRestartQueue } from '~/composables/useInboxRestartQueue'

const props = defineProps<{
  version: string
  hubPort: number
  phase: string
  note: string
  pollMs?: number
  stats: {
    sessionsLive: number | null
    daemonsUp: number | null
    peerUnsent: number | null
    openAcks: number | null
    checkbacks?: number | null
    paneOps?: number | null
  }
  alerts: Array<{
    severity: 'bad' | 'warn' | 'info'
    sessionId: string
    label: string
    text: string
    href: string
    canRestart?: boolean
  }>
  sessions: Array<{
    id: string
    label: string
    sessionName: string
    daemonPort: number
    tmuxLive: boolean
    daemonUp: boolean | null
    inboxReady: boolean | null
    peerUnsent: number | null
    ackOpen: number | null
    checkbackActive: number | null
    proxyDown: boolean
  }>
}>()

const toast = useToast()
const { isRestarting, restartInbox } = useInboxRestartQueue({
  reloadOnly: ['stats', 'sessions', 'alerts', 'note', 'phase'],
  toast,
})
const { start: startPoll } = useAbortableReload({
  only: ['stats', 'sessions', 'alerts', 'note', 'phase'],
  intervalMs: props.pollMs ?? 10000,
})

onMounted(() => startPoll())

function dash(n: number | null | undefined) {
  return n == null ? '—' : String(n)
}

function alertColor(s: string) {
  if (s === 'bad') return 'error' as const
  if (s === 'warn') return 'warning' as const
  return 'info' as const
}

function inboxBadge(row: { daemonUp: boolean | null; inboxReady: boolean | null }) {
  if (row.daemonUp === true) {
    if (row.inboxReady === false) {
      return { color: 'warning' as const, text: 'inbox busy' }
    }
    return { color: 'success' as const, text: 'inbox up' }
  }
  if (row.daemonUp === false) {
    return { color: 'error' as const, text: 'inbox down' }
  }
  return { color: 'neutral' as const, text: 'inbox —' }
}

</script>

<template>
  <Head title="Dashboard" />

  <section class="mb-9 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <p class="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Operator control plane
      </p>
      <h1
        class="font-display text-[clamp(2.5rem,6vw,3.75rem)] font-bold leading-[1.02] tracking-tight text-zinc-900 text-balance"
        translate="no"
      >
        seatmesh
      </h1>
      <p class="mt-3 max-w-lg text-[1.05rem] leading-relaxed text-zinc-500 text-pretty">
        Sessions, daemon health, queues, and notifications — one hub.
        <UBadge color="success" variant="subtle" size="sm" class="ml-1 align-middle">{{ phase }}</UBadge>
      </p>
      <div class="mt-5 flex flex-wrap gap-2">
        <UButton to="/sessions" color="primary" size="md">Open Sessions</UButton>
        <UButton to="#health" color="neutral" variant="outline" size="md">Inbox Health</UButton>
      </div>
    </div>
    <div class="shrink-0 self-start sm:self-end sm:pb-1" aria-hidden="true">
      <SeatmeshMark size="lg" class="opacity-95" />
    </div>
  </section>

  <section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Live totals">
    <div
      v-for="m in [
        { k: 'Sessions live', v: dash(stats.sessionsLive) },
        { k: 'Inboxes up', v: dash(stats.daemonsUp) },
        { k: 'Peer unsent', v: dash(stats.peerUnsent) },
        { k: 'Open ACKs', v: dash(stats.openAcks) },
      ]"
      :key="m.k"
      class="sm-metric"
    >
      <p class="text-xs font-semibold text-zinc-500">{{ m.k }}</p>
      <p class="font-display mt-1 text-[1.85rem] font-semibold tracking-tight sm-num text-zinc-900">
        {{ m.v }}
      </p>
    </div>
  </section>

  <section v-if="alerts.length" class="mb-6" aria-label="Alerts">
    <div class="sm-panel">
      <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <h2 class="text-sm font-semibold text-zinc-900">Alerts</h2>
        <UBadge color="warning" variant="subtle" size="sm">{{ alerts.length }}</UBadge>
      </div>
      <ul class="divide-y divide-zinc-100">
        <li
          v-for="(a, i) in alerts"
          :key="`${a.sessionId}-${i}`"
          class="flex items-center gap-3 px-4 py-2.5 text-sm"
        >
          <ULink
            :to="a.href"
            class="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <UBadge :color="alertColor(a.severity)" variant="subtle" size="sm">{{ a.label }}</UBadge>
            <span class="truncate text-zinc-700">{{ a.text }}</span>
          </ULink>
          <UButton
            v-if="a.canRestart"
            size="xs"
            color="primary"
            variant="soft"
            class="shrink-0"
            :loading="isRestarting(a.sessionId)"
            @click="restartInbox(a.sessionId)"
          >
            Restart
          </UButton>
        </li>
      </ul>
    </div>
  </section>

  <section id="health" class="mb-6 scroll-mt-20" aria-labelledby="health-title">
    <div class="sm-panel">
      <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <h2 id="health-title" class="text-sm font-semibold text-zinc-900">Inbox Health</h2>
        <span class="sm-mono sm-num text-xs text-zinc-500" translate="no">:{{ hubPort }}</span>
      </div>

      <!-- Mobile cards -->
      <ul v-if="sessions.length" class="sm:hidden divide-y divide-zinc-100">
        <li v-for="row in sessions" :key="`m-${row.id}`" class="sm-mobile-card">
          <div class="flex items-start justify-between gap-2">
            <ULink
              :to="`/sessions/${row.id}`"
              class="font-semibold text-primary-700 hover:underline min-w-0 truncate"
              translate="no"
            >
              {{ row.label }}
            </ULink>
            <UBadge v-if="row.proxyDown" color="error" size="sm">proxy</UBadge>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <UBadge color="neutral" variant="subtle" size="sm" class="sm-mono sm-num" translate="no">
              :{{ row.daemonPort }}
            </UBadge>
            <UBadge :color="row.tmuxLive ? 'success' : 'error'" variant="subtle" size="sm">
              {{ row.tmuxLive ? 'tmux' : 'no tmux' }}
            </UBadge>
            <UBadge :color="inboxBadge(row).color" variant="subtle" size="sm">
              {{ inboxBadge(row).text }}
            </UBadge>
          </div>
          <dl class="grid grid-cols-3 gap-2 text-xs text-zinc-500">
            <div>
              <dt>ACK</dt>
              <dd class="sm-num font-medium text-zinc-800">{{ dash(row.ackOpen) }}</dd>
            </div>
            <div>
              <dt>Peer</dt>
              <dd class="sm-num font-medium text-zinc-800">{{ dash(row.peerUnsent) }}</dd>
            </div>
            <div>
              <dt>CB</dt>
              <dd class="sm-num font-medium text-zinc-800">{{ dash(row.checkbackActive) }}</dd>
            </div>
          </dl>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-if="row.daemonUp === false"
              size="xs"
              color="primary"
              variant="soft"
              :loading="isRestarting(row.id)"
              @click="restartInbox(row.id)"
            >
              Restart
            </UButton>
            <UButton :to="`/sessions/${row.id}`" size="xs" color="primary" variant="soft">Open</UButton>
            <UButton :to="`/sessions/${row.id}/targets`" size="xs" color="neutral" variant="ghost">Targets</UButton>
            <UButton :to="`/sessions/${row.id}/queues`" size="xs" color="neutral" variant="ghost">Queues</UButton>
            <UButton :to="`/sessions/${row.id}/ops`" size="xs" color="neutral" variant="ghost">Ops</UButton>
          </div>
        </li>
      </ul>

      <!-- Desktop table -->
      <div v-if="sessions.length" class="hidden sm:block overflow-x-auto">
        <table class="sm-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Port</th>
              <th>tmux</th>
              <th>Inbox</th>
              <th>ACK</th>
              <th>Peer</th>
              <th>CB</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sessions" :key="row.id">
              <td>
                <ULink :to="`/sessions/${row.id}`" class="font-semibold text-primary-700 hover:underline" translate="no">
                  {{ row.label }}
                </ULink>
                <UBadge v-if="row.proxyDown" color="error" size="sm" class="ml-2">proxy</UBadge>
              </td>
              <td class="sm-mono sm-num" translate="no">{{ row.daemonPort }}</td>
              <td>
                <UBadge :color="row.tmuxLive ? 'success' : 'error'" variant="subtle" size="sm">
                  {{ row.tmuxLive ? 'live' : 'stopped' }}
                </UBadge>
              </td>
              <td>
                <UBadge :color="inboxBadge(row).color" variant="subtle" size="sm">
                  {{ inboxBadge(row).text }}
                </UBadge>
              </td>
              <td class="sm-num">{{ dash(row.ackOpen) }}</td>
              <td class="sm-num">{{ dash(row.peerUnsent) }}</td>
              <td class="sm-num">{{ dash(row.checkbackActive) }}</td>
              <td>
                <div class="flex flex-wrap justify-end gap-0.5">
                  <UButton
                    v-if="row.daemonUp === false"
                    size="xs"
                    color="primary"
                    variant="soft"
                    :loading="isRestarting(row.id)"
                    @click="restartInbox(row.id)"
                  >
                    Restart
                  </UButton>
                  <UButton :to="`/sessions/${row.id}`" size="xs" color="neutral" variant="ghost">Open</UButton>
                  <UButton :to="`/sessions/${row.id}/targets`" size="xs" color="neutral" variant="ghost">
                    Targets
                  </UButton>
                  <UButton :to="`/sessions/${row.id}/queues`" size="xs" color="neutral" variant="ghost">
                    Queues
                  </UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="px-4 py-10 text-center text-sm text-zinc-500">No registry sessions yet.</p>
    </div>
  </section>
  <p class="text-sm text-zinc-500">
    <strong class="text-zinc-700" translate="no">seatmesh</strong>
    <span class="sm-num" translate="no">{{ version }}</span>
    · hub <span class="sm-mono sm-num" translate="no">:{{ hubPort }}</span>
    · staying on <strong class="text-zinc-700">1.1.x</strong> until this console ships.
  </p>
  <p class="mt-1 text-sm text-zinc-500">{{ note }}</p>
</template>
