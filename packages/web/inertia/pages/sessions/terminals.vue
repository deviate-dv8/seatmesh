<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'
import { useAbortableFetch } from '~/composables/useAbortable'

type PaneRow = {
  paneId: string
  label: string
  role: string
  slot: string
  mini: string
  ports: string
  window: string
  command: string
}

const props = defineProps<{
  id: string
  note: string
  session: {
    id: string
    label: string
    sessionName: string
    workspace: string
    daemonPort: number
    daemonUp: boolean | null
  }
  agents: {
    leads: Array<Record<string, unknown>>
    workers: Array<Record<string, unknown>>
    minis: Array<Record<string, unknown>>
  }
  panes: PaneRow[]
  wsTmux: string
  tmuxSession: string
  panesError: string | null
}>()

const toast = useToast()
/** Capture-first: live attach freezes the tab when a busy session floods xterm. */
const mode = ref<'attach' | 'capture'>('capture')
const attachWindow = ref<string>('')
const selectedPane = ref<string>(props.panes[0]?.paneId ?? '')
const captureText = ref('')
const sendMsg = ref('')
const sending = ref(false)
const connected = ref(false)
const connecting = ref(false)
const termEl = ref<HTMLElement | null>(null)
const xtermReady = ref(false)

let term: import('@xterm/xterm').Terminal | null = null
let fit: import('@xterm/addon-fit').FitAddon | null = null
let socket: WebSocket | null = null
let captureTimer: ReturnType<typeof setInterval> | undefined
let resizeObs: ResizeObserver | null = null
let writeBuf = ''
let writeRaf = 0
let selectDebounce: ReturnType<typeof setTimeout> | undefined
let reconnectDebounce: ReturnType<typeof setTimeout> | undefined
const captureFetch = useAbortableFetch()

const windows = computed(() => {
  const set = new Set<string>()
  for (const p of props.panes) {
    if (p.window) set.add(p.window)
  }
  return [...set]
})

const selectedPaneRow = computed(() => props.panes.find((p) => p.paneId === selectedPane.value) ?? null)

const liveStatus = computed(() => {
  if (mode.value === 'capture') {
    return { color: 'neutral' as const, text: 'Preview' }
  }
  if (connecting.value) {
    return { color: 'warning' as const, text: 'Live · connecting' }
  }
  if (connected.value) {
    const win = attachWindow.value || 'session'
    const pane = selectedPaneRow.value?.label
    return {
      color: 'success' as const,
      text: pane ? `Live · ${pane} · ${win}` : `Live · ${win}`,
    }
  }
  return { color: 'neutral' as const, text: 'Live · idle' }
})

function wsUrl(): string {
  const cols = term?.cols ?? 120
  const rows = term?.rows ?? 36
  const u = new URL(props.wsTmux)
  u.searchParams.set('cols', String(cols))
  u.searchParams.set('rows', String(rows))
  if (attachWindow.value) u.searchParams.set('window', attachWindow.value)
  if (selectedPane.value) u.searchParams.set('pane', selectedPane.value)
  return u.toString()
}

function flushWriteBuf() {
  writeRaf = 0
  if (!term || !writeBuf) return
  const chunk = writeBuf
  writeBuf = ''
  term.write(chunk)
}

function queueWrite(data: string) {
  writeBuf += data
  // Cap buffer so a flood cannot OOM the tab
  if (writeBuf.length > 400_000) {
    writeBuf = writeBuf.slice(-200_000)
  }
  if (!writeRaf) {
    writeRaf = requestAnimationFrame(flushWriteBuf)
  }
}

function disposeSocket() {
  connecting.value = false
  if (socket) {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
    socket = null
  }
  connected.value = false
  writeBuf = ''
  if (writeRaf) {
    cancelAnimationFrame(writeRaf)
    writeRaf = 0
  }
}

async function ensureXterm() {
  if (term || !termEl.value) return
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ])
  await import('@xterm/xterm/css/xterm.css')
  term = new Terminal({
    cursorBlink: false,
    convertEol: true,
    fontSize: 13,
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    scrollback: 2000,
    theme: {
      background: '#0c0f0c',
      foreground: '#e7e5e4',
      cursor: '#4ade80',
      selectionBackground: '#166534',
    },
    allowProposedApi: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termEl.value)
  fit.fit()
  resizeObs = new ResizeObserver(() => {
    fit?.fit()
    sendResize()
  })
  resizeObs.observe(termEl.value)
  xtermReady.value = true
}

function connectAttach() {
  if (!term) return
  disposeSocket()
  term.clear()
  const paneBit = selectedPane.value ? ` pane ${selectedPane.value}` : ''
  term.writeln(
    `\x1b[90m[seatmesh] attaching ${props.tmuxSession}${attachWindow.value ? ':' + attachWindow.value : ''}${paneBit} (read-only) …\x1b[0m`
  )
  connecting.value = true
  const ws = new WebSocket(wsUrl())
  socket = ws
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    connecting.value = false
    connected.value = true
    term?.writeln('\x1b[32m[seatmesh] live — keys disabled; pick a pane in the list or use Send below\x1b[0m\r\n')
  }
  ws.onclose = () => {
    connecting.value = false
    connected.value = false
    term?.writeln('\r\n\x1b[90m[seatmesh] disconnected\x1b[0m')
  }
  ws.onerror = () => {
    connecting.value = false
    term?.writeln('\r\n\x1b[31m[seatmesh] websocket error (is daemon up?)\x1b[0m')
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') queueWrite(ev.data)
    else queueWrite(new TextDecoder().decode(ev.data as ArrayBuffer))
  }
}

function scheduleLiveReconnect() {
  if (mode.value !== 'attach') return
  if (!(connected.value || connecting.value)) return
  if (reconnectDebounce) clearTimeout(reconnectDebounce)
  reconnectDebounce = setTimeout(() => {
    if (mode.value === 'attach' && term) connectAttach()
  }, 80)
}

function selectPane(paneId: string) {
  const row = props.panes.find((p) => p.paneId === paneId)
  if (!row) return
  selectedPane.value = paneId
  if (row.window && row.window !== attachWindow.value) {
    attachWindow.value = row.window
  }
  if (mode.value === 'attach') {
    scheduleLiveReconnect()
  }
}

function sendResize() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !term) return
  socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
}

async function refreshCapture() {
  if (!selectedPane.value || !props.session.daemonPort) return
  if (typeof document !== 'undefined' && document.hidden) return
  try {
    await captureFetch.run(async (signal) => {
      const res = await fetch(
        `/sessions/${props.session.id}/terminals/capture?pane=${encodeURIComponent(selectedPane.value)}`,
        { signal }
      )
      if (!res.ok) throw new Error(`capture ${res.status}`)
      const data = (await res.json()) as { pane?: { captureTailAnsi?: string; captureTail?: string } }
      // Preview is a plain <pre> — use stripped captureTail (ANSI codes look like [38;2;…m otherwise).
      let raw = data.pane?.captureTail || ''
      if (!raw && data.pane?.captureTailAnsi) {
        raw = data.pane.captureTailAnsi.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      }
      captureText.value = raw.length > 48_000 ? raw.slice(-48_000) : raw
    })
  } catch {
    captureText.value = '(capture failed — daemon down or pane gone)'
  }
}

async function sendToAgent() {
  const msg = sendMsg.value.trim()
  if (!msg || !selectedPane.value) return
  sending.value = true
  router.post(
    `/sessions/${props.session.id}/terminals/send`,
    {
      msg,
      targetPane: selectedPane.value,
      targetLabel: props.panes.find((p) => p.paneId === selectedPane.value)?.label,
      kind: 'prompt',
    },
    {
      preserveScroll: true,
      onSuccess: () => {
        toast.add({ title: 'Sent', description: `→ ${selectedPane.value}`, color: 'success' })
        sendMsg.value = ''
      },
      onError: (errors) => {
        toast.add({
          title: 'Send failed',
          description: Object.values(errors).flat().join(' ') || 'error',
          color: 'error',
        })
      },
      onFinish: () => {
        sending.value = false
      },
    }
  )
}

function startCaptureLoop() {
  if (captureTimer) clearInterval(captureTimer)
  void refreshCapture()
  captureTimer = setInterval(refreshCapture, 2000)
}

function stopCaptureLoop() {
  captureFetch.abort()
  if (captureTimer) {
    clearInterval(captureTimer)
    captureTimer = undefined
  }
}

watch(mode, async (m) => {
  stopCaptureLoop()
  if (m === 'capture') {
    disposeSocket()
    startCaptureLoop()
  } else {
    await nextTick()
    await ensureXterm()
    // Do not auto-connect — explicit Connect avoids freezing the GUI on page open.
  }
})

watch(attachWindow, () => {
  if (mode.value === 'attach' && (connected.value || connecting.value)) {
    scheduleLiveReconnect()
  }
})

watch(selectedPane, () => {
  if (mode.value !== 'capture') return
  if (selectDebounce) clearTimeout(selectDebounce)
  if (captureTimer) {
    clearInterval(captureTimer)
    captureTimer = undefined
  }
  selectDebounce = setTimeout(() => {
    void refreshCapture()
    captureTimer = setInterval(refreshCapture, 2500)
  }, 120)
})

onMounted(() => {
  startCaptureLoop()
})

onUnmounted(() => {
  disposeSocket()
  stopCaptureLoop()
  if (selectDebounce) clearTimeout(selectDebounce)
  if (reconnectDebounce) clearTimeout(reconnectDebounce)
  resizeObs?.disconnect()
  term?.dispose()
  term = null
})

async function startLive() {
  mode.value = 'attach'
  await nextTick()
  await ensureXterm()
  connectAttach()
}

function stopLive() {
  disposeSocket()
  if (term) {
    try {
      term.clear()
      term.writeln('\x1b[90m[seatmesh] disconnected\x1b[0m')
    } catch {
      /* ignore */
    }
  }
  mode.value = 'capture'
  startCaptureLoop()
}

function reloadPage() {
  router.reload({ only: ['panes', 'panesError', 'wsTmux', 'tmuxSession'] })
}

function cycleWindow(dir: -1 | 1) {
  const list = ['', ...windows.value]
  const i = list.indexOf(attachWindow.value)
  const next = list[(i + dir + list.length) % list.length] ?? ''
  attachWindow.value = next
}
</script>

<template>
  <Head :title="`Terminals · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="terminals"
  />

  <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="font-display text-3xl font-bold tracking-tight">Terminals</h1>
      <p class="mt-1 text-sm text-zinc-500 text-pretty">{{ note }}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <UBadge :color="liveStatus.color" variant="subtle" translate="no">{{ liveStatus.text }}</UBadge>
      <UButton
        v-if="connected || connecting"
        size="sm"
        color="neutral"
        variant="soft"
        @click="stopLive"
      >
        Disconnect
      </UButton>
      <UButton size="sm" color="neutral" variant="outline" @click="reloadPage">Refresh panes</UButton>
    </div>
  </header>

  <p v-if="panesError" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    {{ panesError }}
  </p>

  <div class="grid gap-4 lg:grid-cols-[200px_1fr]">
    <aside class="sm-panel relative z-20 max-h-[40vh] lg:max-h-[70vh] overflow-y-auto">
      <div class="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Panes
      </div>
      <ul class="divide-y divide-zinc-50">
        <li v-for="p in panes" :key="p.paneId">
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm hover:bg-zinc-50"
            :class="selectedPane === p.paneId ? 'bg-primary-50' : ''"
            @click="selectPane(p.paneId)"
          >
            <span class="font-medium text-zinc-900" translate="no">{{ p.label }}</span>
            <span class="text-xs text-zinc-400 sm-num" translate="no">{{ p.paneId }} · {{ p.window }}</span>
            <span v-if="p.command" class="truncate text-xs text-zinc-500 sm-mono max-w-full" translate="no">{{
              p.command
            }}</span>
          </button>
        </li>
        <li v-if="!panes.length" class="px-3 py-6 text-center text-xs text-zinc-400">No live panes</li>
      </ul>
    </aside>

    <div class="min-w-0 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          size="sm"
          :color="mode === 'capture' ? 'primary' : 'neutral'"
          :variant="mode === 'capture' ? 'solid' : 'outline'"
          @click="mode = 'capture'"
        >
          Pane preview
        </UButton>
        <UButton
          size="sm"
          :color="mode === 'attach' ? 'primary' : 'neutral'"
          :variant="mode === 'attach' ? 'solid' : 'outline'"
          @click="mode = 'attach'"
        >
          Live view
        </UButton>
        <UBadge :color="liveStatus.color" variant="subtle" size="sm" translate="no">{{ liveStatus.text }}</UBadge>
        <template v-if="mode === 'attach'">
          <UButton size="sm" color="neutral" variant="ghost" title="Previous window" @click="cycleWindow(-1)">
            ◀ win
          </UButton>
          <USelect
            v-model="attachWindow"
            :items="[{ label: 'Full session', value: '' }, ...windows.map((w) => ({ label: w, value: w }))]"
            class="w-40"
            size="sm"
          />
          <UButton size="sm" color="neutral" variant="ghost" title="Next window" @click="cycleWindow(1)">
            win ▶
          </UButton>
          <UButton
            v-if="!connected && !connecting"
            size="sm"
            color="primary"
            :disabled="!session.daemonUp"
            @click="startLive"
          >
            Connect
          </UButton>
          <UButton
            v-if="connected || connecting"
            size="sm"
            color="neutral"
            variant="soft"
            @click="stopLive"
          >
            Disconnect
          </UButton>
        </template>
      </div>

      <div
        v-show="mode === 'attach'"
        class="relative z-0 h-[min(50vh,420px)] sm:h-[min(62vh,560px)] overflow-hidden rounded-xl border border-zinc-800 bg-[#0c0f0c] shadow-[inset_0_0_0_1px_rgb(34_197_94/12%)]"
      >
        <p
          v-if="!connected && !connecting"
          class="pointer-events-none absolute inset-0 z-10 flex items-start p-3 text-xs text-zinc-500"
        >
          Click Connect for a read-only live tmux view. Click a pane in the list to jump windows. Prefer Pane preview on
          phones.
        </p>
        <div ref="termEl" class="h-full w-full p-1 sm:p-2 [&_.xterm]:!outline-none [&_.xterm-viewport]:!overflow-auto" />
      </div>

      <pre
        v-show="mode === 'capture'"
        class="h-[min(50vh,420px)] sm:h-[min(62vh,560px)] overflow-auto rounded-xl border border-zinc-800 bg-[#0c0f0c] p-3 text-[12px] leading-snug text-zinc-100 sm-mono whitespace-pre shadow-[inset_0_0_0_1px_rgb(34_197_94/12%)]"
        translate="no"
      >{{ captureText || 'Select a pane…' }}</pre>

      <div class="sm-panel p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-zinc-900">Send to agent</h2>
          <span class="text-xs text-zinc-400 sm-num" translate="no">{{ selectedPane || '—' }} via /to-peer</span>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <UTextarea
            v-model="sendMsg"
            :rows="2"
            class="flex-1"
            placeholder="Message injected through daemon (not raw send-keys)…"
          />
          <UButton
            color="primary"
            :loading="sending"
            :disabled="!selectedPane || !sendMsg.trim()"
            class="shrink-0 self-end"
            @click="sendToAgent"
          >
            Send
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
