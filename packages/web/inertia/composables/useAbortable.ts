import { onUnmounted, ref } from 'vue'
import { router } from '@inertiajs/vue3'

/**
 * Abortable poll loop for Inertia partial reloads.
 * Cancels in-flight reloads on unmount / tick overlap / tab hidden.
 */
export function useAbortableReload(opts: {
  only: string[]
  intervalMs: number
  /** Skip ticks while document.hidden (default true). */
  pauseWhenHidden?: boolean
}) {
  const busy = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  let visitGen = 0

  function tick() {
    if (opts.pauseWhenHidden !== false && typeof document !== 'undefined' && document.hidden) {
      return
    }
    if (busy.value) {
      // Drop stale overlapping reload — cancel prior visit, start fresh.
      router.cancelAll({ prefetch: false })
    }
    const gen = ++visitGen
    busy.value = true
    router.reload({
      only: opts.only,
      async: true,
      onFinish: () => {
        if (gen === visitGen) busy.value = false
      },
    })
  }

  function start() {
    stop()
    timer = setInterval(tick, opts.intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    router.cancelAll({ prefetch: false })
    busy.value = false
  }

  onUnmounted(stop)

  return { start, stop, busy, tick }
}

/**
 * Abortable fetch helper — aborts prior request when a new one starts or on unmount.
 */
export function useAbortableFetch() {
  let ac: AbortController | undefined

  function abort() {
    ac?.abort()
    ac = undefined
  }

  async function run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    abort()
    const next = new AbortController()
    ac = next
    try {
      return await fn(next.signal)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return undefined
      throw e
    }
  }

  onUnmounted(abort)

  return { run, abort }
}
