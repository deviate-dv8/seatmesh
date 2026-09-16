<script setup lang="ts">
defineProps<{
  sessionId: string
  label?: string
  daemonPort?: number
  daemonUp?: boolean | null
  active?: 'overview' | 'tasks' | 'notifications' | 'targets' | 'queues' | 'terminals' | 'ops' | 'config'
}>()

const links = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'tasks', label: 'Tasks', path: '/tasks' },
  { id: 'notifications', label: 'Notify', path: '/notifications' },
  { id: 'targets', label: 'Targets', path: '/targets' },
  { id: 'queues', label: 'Queues', path: '/queues' },
  { id: 'terminals', label: 'Terminals', path: '/terminals' },
  { id: 'ops', label: 'Ops', path: '/ops' },
  { id: 'config', label: 'Config', path: '/config' },
] as const
</script>

<template>
  <div class="mb-4 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UButton to="/sessions" prefetch="hover" color="neutral" variant="ghost" size="sm" class="-ml-2">
        ← Sessions
      </UButton>
      <UBadge v-if="label" color="neutral" variant="subtle" translate="no">{{ label }}</UBadge>
      <UBadge
        v-if="daemonPort != null"
        :color="daemonUp ? 'success' : 'error'"
        variant="subtle"
        translate="no"
      >
        {{ daemonUp ? `:${daemonPort}` : `down :${daemonPort}` }}
      </UBadge>
    </div>
    <nav
      class="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin"
      aria-label="Session sections"
    >
      <UButton
        v-for="l in links"
        :key="l.id"
        :to="`/sessions/${sessionId}${l.path}`"
        prefetch="hover"
        size="sm"
        :color="active === l.id ? 'primary' : 'neutral'"
        :variant="active === l.id ? 'soft' : 'ghost'"
        class="shrink-0"
      >
        {{ l.label }}
      </UButton>
    </nav>
  </div>
</template>
