import { Engine, end, start, withTitle } from 'waygraph'
import { NavHubRootBlock } from '../blocks/seatmesh-hub/nav-hub-root.block.js'
import { NavSessionConfigBlock } from '../blocks/seatmesh-hub/sessions/_sessionId/config/nav-session-config.block.js'
import { NavSessionsBlock } from '../blocks/seatmesh-hub/sessions/nav-sessions.block.js'

const engine = new Engine({ headless: true })

/** Dashboard → Sessions → session config (FormKit must mount). */
export const hubSmokeFlow = withTitle(
  engine.defineFlow([start, NavHubRootBlock, NavSessionsBlock, NavSessionConfigBlock, end]),
  'Hub smoke'
)
