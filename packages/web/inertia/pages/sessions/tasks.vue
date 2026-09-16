<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'

const props = defineProps<{
  id: string
  all: boolean
  seat: string
  error: string | null
  session: {
    id: string
    label: string
    daemonPort: number
    daemonUp: boolean | null
  }
  tasks: Array<{
    id: string
    seat: string
    text: string
    status: string
    source?: string
    assignedBy?: string
    createdAt: string
    updatedAt: string
    completedAt?: string
  }>
  summary: {
    open: number
    inProgress: number
    done: number
    cancelled: number
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

function reload(opts: { all?: boolean; seat?: string }) {
  const q: Record<string, string> = {}
  if (opts.all ?? props.all) q.all = '1'
  if (opts.seat !== undefined ? opts.seat : props.seat) q.seat = opts.seat ?? props.seat
  router.get(`/sessions/${props.session.id}/tasks`, q, { preserveScroll: true })
}

function statusColor(status: string) {
  if (status === 'done') return 'success'
  if (status === 'open') return 'primary'
  if (status === 'in_progress') return 'warning'
  return 'neutral'
}
</script>

<template>
  <Head :title="`Tasks · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="tasks"
  />

  <header class="mb-4">
    <h1 class="font-display text-3xl font-bold tracking-tight">Tasks</h1>
    <p class="mt-1 text-muted">
      Seat todo ledger · daemon <code class="sm-mono" translate="no">/tasks</code> on
      <span class="sm-mono sm-num" translate="no">:{{ session.daemonPort }}</span>
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <UBadge color="primary" variant="subtle">{{ summary.open }} open</UBadge>
      <UBadge color="success" variant="subtle">{{ summary.done }} done</UBadge>
      <UBadge v-if="summary.updatedAt" color="neutral" variant="subtle">
        updated {{ fmtWhen(summary.updatedAt) }}
      </UBadge>
    </div>
  </header>

  <UAlert v-if="error" color="error" variant="subtle" class="mb-4" :title="error" />

  <UCard class="mb-4">
    <template #header><h2 class="font-semibold">Filter</h2></template>
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="Seat">
        <UInput
          :model-value="seat"
          placeholder="slot-1 · manager · (empty=all)"
          class="w-40"
          @keyup.enter="(e) => reload({ seat: (e.target as HTMLInputElement).value })"
        />
      </UFormField>
      <UButton color="neutral" variant="soft" @click="reload({ seat })">Apply seat</UButton>
      <UButton color="neutral" variant="ghost" @click="reload({ all: !all, seat: '' })">
        {{ all ? 'Active only' : 'Show all (incl. done)' }}
      </UButton>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <h2 class="font-semibold">{{ all ? 'All tasks' : 'Active tasks' }}</h2>
    </template>
    <div v-if="!tasks.length" class="text-sm text-muted">No tasks in ledger yet.</div>
    <div v-else class="overflow-x-auto">
      <table class="sm-table w-full text-sm">
        <thead>
          <tr>
            <th>Status</th>
            <th>Seat</th>
            <th>Task</th>
            <th>Created</th>
            <th>Completed</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in tasks" :key="row.id">
            <td>
              <UBadge :color="statusColor(row.status)" variant="subtle" size="sm">{{ row.status }}</UBadge>
            </td>
            <td class="sm-mono" translate="no">{{ row.seat }}</td>
            <td class="max-w-md truncate" :title="row.text">{{ row.text }}</td>
            <td class="sm-mono whitespace-nowrap">{{ fmtWhen(row.createdAt) }}</td>
            <td class="sm-mono whitespace-nowrap">{{ fmtWhen(row.completedAt) }}</td>
            <td class="sm-mono text-xs text-muted" translate="no">{{ row.id }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
