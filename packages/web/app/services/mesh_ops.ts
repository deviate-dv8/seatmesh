import { spawn } from 'node:child_process'
import { loadProfile } from '@seat-mesh/core'

export type FuncRow = { id: string; command: string }

export function listProfileFuncs(profilePath: string): FuncRow[] {
  const loaded = loadProfile(profilePath)
  const funcs = loaded.profile.funcs ?? {}
  return Object.entries(funcs).map(([id, entry]) => ({
    id,
    command: entry.command,
  }))
}

function profileWorkspace(profilePath: string): string {
  try {
    return loadProfile(profilePath).workspace
  } catch {
    return process.cwd()
  }
}

function runSeatmesh(
  profilePath: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  return new Promise((resolve) => {
    // Hub may be started from another mesh pane (e.g. seatmesh %48). Stripping
    // TMUX_PANE makes inbox lifecycle resolve as operator-shell (always allowed)
    // instead of whoami-"here" against the wrong workspace → "pane %N not found".
    const { TMUX_PANE: _pane, ...env } = process.env
    const child = spawn('seatmesh', ['--profile', profilePath, ...args], {
      cwd: profileWorkspace(profilePath),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      resolve({ code: 124, stdout, stderr: stderr || 'timeout' })
    }, timeoutMs)
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000)
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: e.message })
    })
  })
}

/** Operator inbox restart — works even when daemon HTTP is dead (bypass path). */
export async function restartSessionInbox(profilePath: string) {
  return runSeatmesh(profilePath, ['inbox', 'restart'], { timeoutMs: 90_000 })
}

export async function runSessionFunc(profilePath: string, id: string, args: string[] = []) {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    return { code: 2, stdout: '', stderr: 'invalid func id' }
  }
  return runSeatmesh(profilePath, ['func', id, ...args], { timeoutMs: 120_000 })
}
