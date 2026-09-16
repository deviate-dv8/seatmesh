import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { hubPostJson } from '~/composables/hubFetch'

type RestartResult = {
  ok: boolean
  sessionId: string
  label?: string
  daemonPort?: number
  error?: string
}

/** Module singleton — pending restarts survive page hops within the hub. */
const pendingIds = ref<string[]>([])
let reloadTimer: ReturnType<typeof setTimeout> | undefined
let reloadOnly: string[] | undefined

function addPending(sessionId: string) {
  if (pendingIds.value.includes(sessionId)) return
  pendingIds.value = [...pendingIds.value, sessionId]
}

function removePending(sessionId: string) {
  pendingIds.value = pendingIds.value.filter((id) => id !== sessionId)
}

function scheduleReload(only?: string[]) {
  if (!only?.length) return
  reloadOnly = only
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    router.reload({ only: reloadOnly!, async: true })
    reloadTimer = undefined
  }, 400)
}

/**
 * Background inbox-restart queue. Each session gets its own loading state;
 * clicks enqueue fetch POSTs that do not go through Inertia (no cancelAll).
 */
export function useInboxRestartQueue(opts?: {
  /** Partial reload keys after restarts finish (debounced). */
  reloadOnly?: string[]
  toast?: { add: (opts: { title: string; description?: string; color: string }) => void }
}) {
  const pendingCount = computed(() => pendingIds.value.length)

  function isRestarting(sessionId: string) {
    return pendingIds.value.includes(sessionId)
  }

  async function restartInbox(sessionId: string) {
    if (isRestarting(sessionId)) return
    addPending(sessionId)
    try {
      const { ok, data } = await hubPostJson<RestartResult>(
        `/sessions/${sessionId}/ops/inbox-restart`,
        {}
      )
      if (ok && data.ok) {
        opts?.toast?.add({
          title: 'Inbox restarted',
          description: data.label
            ? `${data.label} (:${data.daemonPort ?? '?'})`
            : sessionId,
          color: 'success',
        })
      } else {
        const detail = data.error || 'Restart failed'
        opts?.toast?.add({
          title: 'Inbox restart failed',
          description: detail.slice(0, 200),
          color: 'error',
        })
      }
    } catch (e) {
      opts?.toast?.add({
        title: 'Inbox restart failed',
        description: e instanceof Error ? e.message : String(e),
        color: 'error',
      })
    } finally {
      removePending(sessionId)
      scheduleReload(opts?.reloadOnly)
    }
  }

  return { pendingIds, pendingCount, isRestarting, restartInbox }
}
