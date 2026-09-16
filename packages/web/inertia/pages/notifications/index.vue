<script setup lang="ts">
import { onMounted } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useAbortableReload } from '~/composables/useAbortable'
import { useInboxRestartQueue } from '~/composables/useInboxRestartQueue'

const props = defineProps<{
  note: string
  pollMs?: number
  items: Array<{
    severity: 'bad' | 'warn' | 'info'
    sessionId: string
    label: string
    text: string
    href: string
    when: string
    canRestart?: boolean
    kind?: 'health' | 'notify'
  }>
}>()

const toast = useToast()
const { isRestarting, restartInbox } = useInboxRestartQueue({
  reloadOnly: ['items', 'note'],
  toast,
})
const { start: startPoll } = useAbortableReload({
  only: ['items', 'note'],
  intervalMs: props.pollMs ?? 10000,
})

onMounted(() => startPoll())

function color(s: string) {
  if (s === 'bad') return 'error' as const
  if (s === 'warn') return 'warning' as const
  return 'info' as const
}

</script>

<template>
  <Head title="Notifications" />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight text-zinc-900">Notifications</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
  </header>

  <div class="sm-panel">
    <ul v-if="items.length" class="divide-y divide-zinc-100">
      <li
        v-for="(item, i) in items"
        :key="`${item.sessionId}-${i}`"
        class="flex items-center gap-3 px-4 py-3 text-sm"
      >
        <ULink
          :to="item.href"
          class="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <UBadge :color="color(item.severity)" variant="subtle" size="sm">
            {{ item.label }}{{ item.kind === 'notify' ? ' · notify' : '' }}
          </UBadge>
          <span class="min-w-0 flex-1 truncate text-zinc-700">{{ item.text }}</span>
        </ULink>
        <UButton
          v-if="item.canRestart"
          size="xs"
          color="primary"
          variant="soft"
          class="shrink-0"
          :loading="isRestarting(item.sessionId)"
          @click="restartInbox(item.sessionId)"
        >
          Restart
        </UButton>
      </li>
    </ul>
    <p v-else class="px-4 py-10 text-center text-sm text-zinc-500">No mesh alerts right now.</p>
  </div>
</template>
