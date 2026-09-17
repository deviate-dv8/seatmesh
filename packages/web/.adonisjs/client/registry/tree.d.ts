/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  home: typeof routes['home']
  sessions: {
    index: typeof routes['sessions.index']
    show: typeof routes['sessions.show']
    tasks: typeof routes['sessions.tasks']
    notifications: typeof routes['sessions.notifications']
    targets: typeof routes['sessions.targets'] & {
      store: typeof routes['sessions.targets.store']
      action: typeof routes['sessions.targets.action']
    }
    queues: typeof routes['sessions.queues'] & {
      cb: {
        cancel: typeof routes['sessions.queues.cb.cancel']
      }
      inbox: {
        resolve: typeof routes['sessions.queues.inbox.resolve']
      }
      ack: {
        clear: typeof routes['sessions.queues.ack.clear']
      }
    }
    terminals: typeof routes['sessions.terminals'] & {
      capture: typeof routes['sessions.terminals.capture']
      send: typeof routes['sessions.terminals.send']
    }
    config: typeof routes['sessions.config'] & {
      update: typeof routes['sessions.config.update']
    }
    ops: typeof routes['sessions.ops'] & {
      inboxRestart: typeof routes['sessions.ops.inboxRestart']
      func: typeof routes['sessions.ops.func']
    }
  }
  notifications: {
    index: typeof routes['notifications.index']
  }
  act: {
    card: typeof routes['act.card']
    v1: typeof routes['act.v1']
  }
  mds: {
    index: typeof routes['mds.index']
    show: typeof routes['mds.show']
  }
  tools: {
    index: typeof routes['tools.index']
  }
}
