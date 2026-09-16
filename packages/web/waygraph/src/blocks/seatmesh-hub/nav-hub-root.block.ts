import { defineNavBlock, Trait } from 'waygraph'
import type { HubDashboard } from '../../states/hub.states.js'

export const NavHubRootBlock = defineNavBlock<HubDashboard>({
  name: 'nav-hub-root',
  description: 'Operator dashboard at /',
  checkpoint: 'HubDashboard',
  url: '/',
  verify: [
    Trait.url({ pathname: '/' }),
    Trait.visible('#main'),
    Trait.visible('nav[aria-label="Primary"]'),
  ],
})
