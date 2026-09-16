import { test, expect } from '@playwright/test'
import { MemPage, checkpoint } from 'waygraph'
import { hubSmokeFlow } from '../src/flows/hub-smoke.flow.js'
import { SessionId } from '../src/states/hub.mem-keys.js'

function resolveSessionId(): string {
  const fromEnv = process.env.SEATMESH_WG_SESSION_ID?.trim()
  if (fromEnv) return fromEnv
  throw new Error('SEATMESH_WG_SESSION_ID unset — run via playwright (global-setup) or export it')
}

test('hubSmokeFlow: dashboard, sessions list, config form renders', async () => {
  const mem = new MemPage()
  mem.set(SessionId, resolveSessionId())

  const result = await hubSmokeFlow.run(mem)

  expect(result).toEqual(checkpoint('SessionConfigPage'))
})
