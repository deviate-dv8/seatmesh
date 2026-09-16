import { defineNavBlock, Trait } from 'waygraph'
import type { SessionsList } from '../../../states/hub.states.js'

export const NavSessionsBlock = defineNavBlock<SessionsList>({
  name: 'nav-sessions',
  description: 'Mesh session registry',
  checkpoint: 'SessionsList',
  click: 'nav[aria-label="Primary"] >> text=Sessions',
  verify: [
    Trait.url({ pathname: '/sessions' }),
    Trait.visible('h1'),
    Trait.text('h1', 'Sessions'),
  ],
})
