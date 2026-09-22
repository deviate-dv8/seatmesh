<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'
import { useInboxRestartQueue } from '~/composables/useInboxRestartQueue'

const props = defineProps<{
  id: string
  note: string
  session: {
    id: string
    label: string
    sessionName: string
    workspace: string
    profilePath: string
    daemonPort: number
    daemonUp: boolean | null
  }
  funcs: Array<{ id: string; command: string }>
  funcsError: string | null
}>()

const toast = useToast()
const { isRestarting, restartInbox: queueRestart } = useInboxRestartQueue({ toast })
const runningId = ref<string | null>(null)
const funcArgs = ref<Record<string, string>>({})
const isKilling = ref(false)

function restartInbox() {
  void queueRestart(props.session.id)
}

function killSession() {
  if (!confirm(`Kill session "${props.session.label}" (${props.session.sessionName})? This ends the tmux session and daemon.`)) {
    return
  }
  isKilling.value = true
  router.post(
    `/sessions/${props.session.id}/ops/kill`,
    {},
    {
      preserveScroll: true,
      onFinish: () => {
        isKilling.value = false
      },
      onError: () => {
        toast.add({ title: 'Kill failed', color: 'error' })
      },
    }
  )
}

function runFunc(id: string) {
  runningId.value = id
  router.post(
    `/sessions/${props.session.id}/ops/func`,
    {
      funcId: id,
      args: funcArgs.value[id] ?? '',
    },
    {
      preserveScroll: true,
      onFinish: () => {
        runningId.value = null
      },
      onError: () => {
        toast.add({ title: 'Func failed', color: 'error' })
      },
    }
  )
}
</script>

<template>
  <Head :title="`Ops · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="ops"
  />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">Ops</h1>
    <p class="mt-1 text-sm text-zinc-500 text-pretty">{{ note }}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <UBadge :color="session.daemonUp ? 'success' : 'error'" variant="subtle" translate="no">
        {{ session.daemonUp ? `daemon :${session.daemonPort}` : `daemon down :${session.daemonPort}` }}
      </UBadge>
      <span class="text-xs text-zinc-400 sm-mono" translate="no">{{ session.profilePath }}</span>
    </div>
  </header>

  <div class="grid gap-4 lg:grid-cols-2">
    <div class="sm-panel p-4 space-y-3">
      <h2 class="text-sm font-semibold text-zinc-900">Inbox</h2>
      <p class="text-sm text-zinc-500 text-pretty">
        Restarts mesh-inbox for this session via CLI (<code class="sm-mono text-xs">inbox restart</code>).
        Use when health is dead and agents are on bypass.
      </p>
      <UButton color="primary" :loading="isRestarting(session.id)" @click="restartInbox">
        Restart inbox
      </UButton>
    </div>

    <div class="sm-panel overflow-hidden">
      <div class="border-b border-zinc-100 px-4 py-3">
        <h2 class="text-sm font-semibold text-zinc-900">Funcs</h2>
        <p class="mt-0.5 text-xs text-zinc-400">From mesh.config.yaml <code class="sm-mono">funcs:</code></p>
      </div>
      <p v-if="funcsError" class="px-4 py-3 text-sm text-amber-800">{{ funcsError }}</p>
      <ul v-else-if="funcs.length" class="divide-y divide-zinc-50">
        <li v-for="f in funcs" :key="f.id" class="px-4 py-3 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-zinc-900" translate="no">{{ f.id }}</div>
              <code class="block truncate text-xs text-zinc-500 sm-mono" translate="no">{{ f.command }}</code>
            </div>
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              :loading="runningId === f.id"
              class="shrink-0"
              @click="runFunc(f.id)"
            >
              Run
            </UButton>
          </div>
          <UInput
            v-model="funcArgs[f.id]"
            size="sm"
            placeholder="optional args…"
            class="w-full"
            translate="no"
          />
        </li>
      </ul>
      <p v-else class="px-4 py-8 text-center text-sm text-zinc-400">No funcs in profile.</p>
    </div>

    <div class="sm-panel p-4 space-y-3 border-red-200">
      <h2 class="text-sm font-semibold text-red-900">Danger zone</h2>
      <p class="text-sm text-zinc-500 text-pretty">
        Kills the tmux session and stops the daemon for this workspace — same as
        <code class="sm-mono text-xs">session down</code>. No undo; agents lose whatever
        wasn't saved.
      </p>
      <UButton color="error" variant="solid" :loading="isKilling" @click="killSession">
        Kill session
      </UButton>
    </div>
  </div>
</template>
