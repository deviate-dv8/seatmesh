<script setup lang="ts">
import { Head } from '@inertiajs/vue3'

defineProps<{
  sessions: Array<{
    id: string
    label: string
    sessionName: string
    daemonPort: number
    tmuxLive: boolean
    daemonUp: boolean | null
    tasksOpen: number | null
    tasksDone: number | null
  }>
  note: string
}>()
</script>

<template>
  <Head title="Sessions" />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight text-zinc-900 text-balance">Sessions</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
  </header>

  <div class="sm-panel">
    <!-- Mobile -->
    <ul v-if="sessions.length" class="sm:hidden divide-y divide-zinc-100">
      <li v-for="row in sessions" :key="`m-${row.id}`" class="sm-mobile-card">
        <ULink
          :to="`/sessions/${row.id}`"
          class="font-semibold text-primary-700 hover:underline truncate"
          translate="no"
        >
          {{ row.label }}
        </ULink>
        <p class="sm-mono text-xs text-zinc-400 truncate" translate="no">{{ row.sessionName }}</p>
        <div class="flex flex-wrap gap-1.5">
          <UBadge color="neutral" variant="subtle" size="sm" class="sm-mono sm-num" translate="no">
            :{{ row.daemonPort }}
          </UBadge>
          <UBadge :color="row.tmuxLive ? 'success' : 'error'" variant="subtle" size="sm">
            {{ row.tmuxLive ? 'tmux live' : 'tmux stopped' }}
          </UBadge>
          <UBadge
            :color="row.daemonUp ? 'success' : row.daemonUp === false ? 'error' : 'neutral'"
            variant="subtle"
            size="sm"
          >
            {{ row.daemonUp ? 'daemon up' : row.daemonUp === false ? 'daemon down' : '—' }}
          </UBadge>
        </div>
        <div class="flex flex-wrap gap-1">
          <UButton :to="`/sessions/${row.id}`" size="xs" color="primary" variant="soft">Open</UButton>
          <UButton :to="`/sessions/${row.id}/tasks`" size="xs" color="neutral" variant="ghost">Tasks</UButton>
          <UButton :to="`/sessions/${row.id}/targets`" size="xs" color="neutral" variant="ghost">Targets</UButton>
          <UButton :to="`/sessions/${row.id}/queues`" size="xs" color="neutral" variant="ghost">Queues</UButton>
          <UButton :to="`/sessions/${row.id}/ops`" size="xs" color="neutral" variant="ghost">Ops</UButton>
          <UButton :to="`/sessions/${row.id}/terminals`" size="xs" color="neutral" variant="ghost">
            Terminals
          </UButton>
        </div>
      </li>
    </ul>

    <!-- Desktop -->
    <div v-if="sessions.length" class="hidden sm:block overflow-x-auto">
      <table class="sm-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>tmux</th>
            <th>Port</th>
            <th>Status</th>
            <th>Tasks</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sessions" :key="row.id">
            <td>
              <ULink :to="`/sessions/${row.id}`" class="font-semibold text-primary-700 hover:underline" translate="no">
                {{ row.label }}
              </ULink>
            </td>
            <td class="sm-mono truncate max-w-[14rem]" translate="no">{{ row.sessionName }}</td>
            <td class="sm-mono sm-num" translate="no">{{ row.daemonPort }}</td>
            <td>
              <div class="flex flex-wrap gap-1">
                <UBadge :color="row.tmuxLive ? 'success' : 'error'" variant="subtle" size="sm">
                  {{ row.tmuxLive ? 'tmux live' : 'tmux stopped' }}
                </UBadge>
                <UBadge
                  :color="row.daemonUp ? 'success' : row.daemonUp === false ? 'error' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ row.daemonUp ? 'daemon up' : row.daemonUp === false ? 'daemon down' : '—' }}
                </UBadge>
              </div>
            </td>
            <td class="sm-mono sm-num text-xs">
              <span v-if="row.tasksOpen != null">{{ row.tasksOpen }} open</span>
              <span v-if="row.tasksDone != null" class="text-muted"> · {{ row.tasksDone }} done</span>
              <span v-if="row.tasksOpen == null && row.tasksDone == null">—</span>
            </td>
            <td>
              <div class="flex justify-end gap-0.5">
                <UButton :to="`/sessions/${row.id}`" size="xs" color="neutral" variant="ghost">Open</UButton>
                <UButton :to="`/sessions/${row.id}/tasks`" size="xs" color="neutral" variant="ghost">Tasks</UButton>
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
    <p v-else class="px-4 py-10 text-center text-sm text-zinc-500">No sessions yet.</p>
  </div>
</template>
