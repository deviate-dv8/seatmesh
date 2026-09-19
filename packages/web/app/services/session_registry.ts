import { spawnSync } from 'node:child_process'
import {
  hostSupervisorSessionsByProfilePath,
  readGlobalRegistry,
  readHostSupervisorMeta,
  type GlobalSessionEntry,
} from '@seat-mesh/core'

export type HubSession = GlobalSessionEntry & {
  tmuxLive: boolean
  daemonUp: boolean | null
  health: DaemonHealth | null
  /**
   * TODO 7.5 (partial — backend only, no UI wired up yet): true when this
   * session's daemon is managed by the opt-in `seatmesh host` supervisor
   * (TODO 7.1) instead of its own per-mesh supervisor. Informational only —
   * does not change daemonUp/health, which still come from /health same as
   * before either way.
   */
  viaHostSupervisor: boolean
}

export type DaemonHealth = {
  ok?: boolean
  session?: string
  port?: number
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
}

/**
 * Parallel /health with retries.
 * Budget must cover loaded meshes (pia/zsign often 0.5–3s when checkbacks/peer backlog are hot).
 */
const HEALTH_PROBE_MS = 3500
const HEALTH_PROBE_ATTEMPTS = 2
/** Short TTL so session tab hops reuse probes instead of re-hitting every daemon. */
const HEALTH_CACHE_TTL_MS = 2500

type HealthCacheEntry = { at: number; health: DaemonHealth | null }
const healthCache = new Map<number, HealthCacheEntry>()
const healthInflight = new Map<number, Promise<DaemonHealth | null>>()

function readCachedHealth(port: number): DaemonHealth | null | undefined {
  const hit = healthCache.get(port)
  if (!hit) return undefined
  if (Date.now() - hit.at > HEALTH_CACHE_TTL_MS) {
    healthCache.delete(port)
    return undefined
  }
  return hit.health
}

function writeCachedHealth(port: number, health: DaemonHealth | null) {
  healthCache.set(port, { at: Date.now(), health })
}

/** Drop cache (tests / after inbox restart from hub). */
export function clearDaemonHealthCache(port?: number) {
  if (port == null) {
    healthCache.clear()
    healthInflight.clear()
    return
  }
  healthCache.delete(port)
  healthInflight.delete(port)
}

async function fetchDaemonHealthRaw(
  port: number,
  signal?: AbortSignal
): Promise<DaemonHealth | null> {
  if (!port || port <= 0) return null
  for (let i = 0; i < HEALTH_PROBE_ATTEMPTS; i++) {
    if (signal?.aborted) return null
    try {
      const ac = new AbortController()
      const onAbort = () => ac.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const t = setTimeout(() => ac.abort(), HEALTH_PROBE_MS)
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal })
        if (!res.ok) continue
        return (await res.json()) as DaemonHealth
      } finally {
        clearTimeout(t)
        signal?.removeEventListener('abort', onAbort)
      }
    } catch {
      /* retry */
    }
  }
  return null
}

/** Parallel /health with retries — matches CLI agent sessions probe. */
export async function probeDaemonHealth(port: number, signal?: AbortSignal): Promise<boolean> {
  const h = await fetchDaemonHealth(port, signal)
  return h?.ok === true
}

export async function fetchDaemonHealth(
  port: number,
  signal?: AbortSignal
): Promise<DaemonHealth | null> {
  if (!port || port <= 0) return null
  const cached = readCachedHealth(port)
  if (cached !== undefined) return cached

  const existing = healthInflight.get(port)
  if (existing) return existing

  const pending = (async () => {
    const health = await fetchDaemonHealthRaw(port, signal)
    writeCachedHealth(port, health)
    return health
  })().finally(() => {
    healthInflight.delete(port)
  })

  healthInflight.set(port, pending)
  return pending
}

function tmuxHasSession(name: string): boolean {
  if (!name) return false
  const r = spawnSync('tmux', ['has-session', '-t', name], { encoding: 'utf8' })
  return r.status === 0
}

export type ListHubSessionsOpts = {
  /** Probe every session's /health (default true). */
  probe?: boolean
  /** When set with probe, only hit this session's daemon — others stay unprobed. */
  probeSessionId?: string
  signal?: AbortSignal
}

/** Registry rows + tmux live flag + optional /health. */
export async function listHubSessions(opts: ListHubSessionsOpts = {}): Promise<HubSession[]> {
  const probe = opts.probe !== false
  const reg = readGlobalRegistry()
  const wantId = opts.probeSessionId?.trim()
  // Cheap (one small local file, no network) — safe to read on every call.
  const hostSupervisorSessions = hostSupervisorSessionsByProfilePath(readHostSupervisorMeta())

  const rows = await Promise.all(
    reg.sessions.map(async (s) => {
      const viaHostSupervisor = hostSupervisorSessions.has(s.profilePath)
      const tmuxLive = tmuxHasSession(s.sessionName)
      let daemonUp: boolean | null = null
      let health: DaemonHealth | null = null
      const shouldProbe =
        probe &&
        s.daemonPort > 0 &&
        (!wantId || s.id === wantId || s.sessionName === wantId || s.label === wantId)
      if (shouldProbe) {
        health = await fetchDaemonHealth(s.daemonPort, opts.signal)
        daemonUp = health?.ok === true
      } else if (probe && s.daemonPort > 0) {
        const cached = readCachedHealth(s.daemonPort)
        if (cached !== undefined) {
          health = cached
          daemonUp = cached?.ok === true
        }
      }
      return { ...s, tmuxLive, daemonUp, health, viaHostSupervisor }
    })
  )
  return rows
}

/**
 * Resolve one session without probing every mesh on the host.
 * Uses TTL health cache + single-port fetch.
 */
export async function getHubSession(
  id: string,
  opts: { probe?: boolean; signal?: AbortSignal } = {}
): Promise<HubSession | undefined> {
  const probe = opts.probe !== false
  const sessions = await listHubSessions({
    probe,
    probeSessionId: id,
    signal: opts.signal,
  })
  return findHubSession(id, sessions)
}

export function aggregateStats(sessions: HubSession[]) {
  return {
    sessionsLive: sessions.filter((s) => s.tmuxLive).length,
    daemonsUp: sessions.filter((s) => s.daemonUp === true).length,
    peerUnsent: sessions.reduce((n, s) => n + (s.health?.peerUnsent ?? 0), 0),
    openAcks: sessions.reduce((n, s) => n + (s.health?.ackOpen ?? 0), 0),
  }
}

export function findHubSession(id: string, sessions: HubSession[]): HubSession | undefined {
  return sessions.find((s) => s.id === id || s.sessionName === id || s.label === id)
}
