<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'

const props = defineProps<{
  id: string
  all: boolean
  error: string | null
  session: {
    id: string
    label: string
    daemonPort: number
    daemonUp: boolean | null
  }
  notifications: Array<{
    id: string
    kind: string
    title: string
    body?: string
    check?: string
    fromSeat?: string
    targetSeat?: string
    url?: string
    infoUrl?: string
    cardId?: string
    status: string
    createdAt: string
    expiresAt?: string
    actedAt?: string
    actedLabel?: string
  }>
  summary: {
    sent: number
    acted: number
    expired: number
    updatedAt: string | null
  }
}>()

function fmtWhen(iso: string | undefined) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function kindColor(kind: string) {
  if (kind === 'yesno') return 'warning' as const
  if (kind === 'info') return 'primary' as const
  if (kind === 'link') return 'info' as const
  return 'neutral' as const
}

function statusColor(status: string) {
  if (status === 'acted') return 'success' as const
  if (status === 'expired') return 'neutral' as const
  return 'primary' as const
}

function cardHref(row: { infoUrl?: string; cardId?: string }) {
  if (row.infoUrl) return row.infoUrl
  if (row.cardId) return `/act/card/${row.cardId}?port=${props.session.daemonPort}`
  return undefined
}

function toggleAll() {
  router.get(
    `/sessions/${props.session.id}/notifications`,
    { all: props.all ? undefined : '1' },
    { preserveScroll: true },
  )
}
</script>

<template>
  <Head :title="`Notifications · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="notifications"
  />

  <header class="mb-4">
    <h1 class="font-display text-3xl font-bold tracking-tight">Notifications</h1>
    <p class="mt-1 text-muted">
      Saved agent/operator notify history · daemon
      <code class="sm-mono" translate="no">/notifications</code> on
      <span class="sm-mono sm-num" translate="no">:{{ session.daemonPort }}</span>
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <UBadge color="primary" variant="subtle">{{ summary.sent }} sent</UBadge>
      <UBadge color="success" variant="subtle">{{ summary.acted }} acted</UBadge>
      <UBadge v-if="summary.expired" color="neutral" variant="subtle">{{ summary.expired }} expired</UBadge>
    </div>
  </header>

  <UAlert v-if="error" color="error" variant="subtle" class="mb-4" :title="error" />

  <div class="mb-4">
    <UButton color="neutral" variant="soft" size="sm" @click="toggleAll">
      {{ all ? 'Active only' : 'Show all (incl. acted/expired)' }}
    </UButton>
  </div>

  <UCard>
    <template #header><h2 class="font-semibold">History</h2></template>
    <div v-if="!notifications.length" class="text-sm text-muted">No saved notifications yet.</div>
    <div v-else class="overflow-x-auto">
      <table class="sm-table w-full text-sm">
        <thead>
          <tr>
            <th>When</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Title</th>
            <th>Detail</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in notifications" :key="row.id">
            <td class="sm-mono whitespace-nowrap text-xs">{{ fmtWhen(row.createdAt) }}</td>
            <td><UBadge :color="kindColor(row.kind)" variant="subtle" size="sm">{{ row.kind }}</UBadge></td>
            <td>
              <UBadge :color="statusColor(row.status)" variant="subtle" size="sm">
                {{ row.status }}{{ row.actedLabel ? ` (${row.actedLabel})` : '' }}
              </UBadge>
            </td>
            <td class="max-w-[10rem] truncate font-medium" :title="row.title">{{ row.title }}</td>
            <td class="max-w-md truncate text-muted" :title="row.check || row.body">
              {{ row.check || row.body || row.fromSeat || '—' }}
            </td>
            <td class="whitespace-nowrap">
              <UButton
                v-if="cardHref(row)"
                :href="cardHref(row)"
                target="_blank"
                rel="noopener"
                size="xs"
                color="primary"
                variant="ghost"
              >
                Info
              </UButton>
              <UButton
                v-if="row.url"
                :href="row.url"
                target="_blank"
                rel="noopener"
                size="xs"
                color="neutral"
                variant="ghost"
              >
                Open
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
