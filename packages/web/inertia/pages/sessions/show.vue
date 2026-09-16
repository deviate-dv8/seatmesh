<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'

defineProps<{
  id: string
  note: string
  session: {
    id: string
    label: string
    sessionName: string
    workspace: string
    profilePath: string
    daemonPort: number
    tmuxLive: boolean
    daemonUp: boolean | null
    health: {
      ok?: boolean
      peerUnsent?: number
      ackOpen?: number
      paneOpsPending?: number
      inboxUnresolved?: number
      checkbackActive?: number
      proxyDownActive?: boolean
      ready?: boolean
      workerPanes?: number
      miniPanes?: number
      tasksOpen?: number
      tasksDone?: number
      tasksUpdatedAt?: string | null
      notifySent?: number
      notifyActed?: number
      notifyUpdatedAt?: string | null
    } | null
  }
}>()
</script>

<template>
  <Head :title="`Session ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="overview"
  />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight text-balance" translate="no">
      {{ session.label }}
    </h1>
    <p class="mt-1 text-muted text-pretty">{{ note }}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <UBadge :color="session.tmuxLive ? 'success' : 'error'" variant="subtle">
        {{ session.tmuxLive ? 'tmux live' : 'tmux stopped' }}
      </UBadge>
    </div>
  </header>

  <div class="grid gap-3 sm:grid-cols-2">
    <UCard>
      <template #header><h2 class="font-semibold">Overview</h2></template>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">tmux</dt>
        <dd class="sm-mono break-all" translate="no">{{ session.sessionName }}</dd>
        <dt class="text-muted">workspace</dt>
        <dd class="break-all" translate="no">{{ session.workspace }}</dd>
        <dt class="text-muted">profile</dt>
        <dd class="break-all" translate="no">{{ session.profilePath }}</dd>
        <dt class="text-muted">ready</dt>
        <dd>{{ session.health?.ready ?? '—' }}</dd>
        <dt class="text-muted">proxyDown</dt>
        <dd>{{ session.health?.proxyDownActive ?? '—' }}</dd>
      </dl>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Queues</h2>
          <UButton :to="`/sessions/${session.id}/queues`" size="xs" color="neutral" variant="ghost">Open</UButton>
        </div>
      </template>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">peer unsent</dt>
        <dd class="sm-num">{{ session.health?.peerUnsent ?? '—' }}</dd>
        <dt class="text-muted">open acks</dt>
        <dd class="sm-num">{{ session.health?.ackOpen ?? '—' }}</dd>
        <dt class="text-muted">inbox unresolved</dt>
        <dd class="sm-num">{{ session.health?.inboxUnresolved ?? '—' }}</dd>
        <dt class="text-muted">checkbacks</dt>
        <dd class="sm-num">{{ session.health?.checkbackActive ?? '—' }}</dd>
        <dt class="text-muted">pane-ops</dt>
        <dd class="sm-num">{{ session.health?.paneOpsPending ?? '—' }}</dd>
      </dl>
    </UCard>

    <UCard>
      <template #header><h2 class="font-semibold">Panes</h2></template>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">workers</dt>
        <dd class="sm-num">{{ session.health?.workerPanes ?? '—' }}</dd>
        <dt class="text-muted">minis</dt>
        <dd class="sm-num">{{ session.health?.miniPanes ?? '—' }}</dd>
      </dl>
      <p class="mt-3 text-sm text-muted">
        <UButton :to="`/sessions/${session.id}/terminals`" size="xs" color="neutral" variant="ghost">Terminals</UButton>
        ·
        <UButton :to="`/sessions/${session.id}/ops`" size="xs" color="neutral" variant="ghost">Ops (restart)</UButton>
      </p>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Tasks</h2>
          <UButton :to="`/sessions/${session.id}/tasks`" size="xs" color="neutral" variant="ghost">Open</UButton>
        </div>
      </template>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">open</dt>
        <dd class="sm-num">{{ session.health?.tasksOpen ?? '—' }}</dd>
        <dt class="text-muted">done</dt>
        <dd class="sm-num">{{ session.health?.tasksDone ?? '—' }}</dd>
        <dt class="text-muted">ledger updated</dt>
        <dd class="sm-mono text-xs">{{ session.health?.tasksUpdatedAt ?? '—' }}</dd>
      </dl>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Notifications</h2>
          <UButton :to="`/sessions/${session.id}/notifications`" size="xs" color="neutral" variant="ghost">
            Open
          </UButton>
        </div>
      </template>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">sent</dt>
        <dd class="sm-num">{{ session.health?.notifySent ?? '—' }}</dd>
        <dt class="text-muted">acted</dt>
        <dd class="sm-num">{{ session.health?.notifyActed ?? '—' }}</dd>
        <dt class="text-muted">updated</dt>
        <dd class="sm-mono text-xs">{{ session.health?.notifyUpdatedAt ?? '—' }}</dd>
      </dl>
    </UCard>

    <UCard>
      <template #header><h2 class="font-semibold">Targets</h2></template>
      <UButton :to="`/sessions/${session.id}/targets`" color="primary" size="sm">Open Targets</UButton>
    </UCard>
  </div>
</template>
