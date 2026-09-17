/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'home': {
    methods: ["GET","HEAD"],
    pattern: '/',
    tokens: [{"old":"/","type":0,"val":"/","end":""}],
    types: placeholder as Registry['home']['types'],
  },
  'sessions.index': {
    methods: ["GET","HEAD"],
    pattern: '/sessions',
    tokens: [{"old":"/sessions","type":0,"val":"sessions","end":""}],
    types: placeholder as Registry['sessions.index']['types'],
  },
  'sessions.show': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id',
    tokens: [{"old":"/sessions/:id","type":0,"val":"sessions","end":""},{"old":"/sessions/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['sessions.show']['types'],
  },
  'sessions.tasks': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/tasks',
    tokens: [{"old":"/sessions/:id/tasks","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/tasks","type":1,"val":"id","end":""},{"old":"/sessions/:id/tasks","type":0,"val":"tasks","end":""}],
    types: placeholder as Registry['sessions.tasks']['types'],
  },
  'sessions.notifications': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/notifications',
    tokens: [{"old":"/sessions/:id/notifications","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/notifications","type":1,"val":"id","end":""},{"old":"/sessions/:id/notifications","type":0,"val":"notifications","end":""}],
    types: placeholder as Registry['sessions.notifications']['types'],
  },
  'sessions.targets': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/targets',
    tokens: [{"old":"/sessions/:id/targets","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/targets","type":1,"val":"id","end":""},{"old":"/sessions/:id/targets","type":0,"val":"targets","end":""}],
    types: placeholder as Registry['sessions.targets']['types'],
  },
  'sessions.targets.store': {
    methods: ["POST"],
    pattern: '/sessions/:id/targets',
    tokens: [{"old":"/sessions/:id/targets","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/targets","type":1,"val":"id","end":""},{"old":"/sessions/:id/targets","type":0,"val":"targets","end":""}],
    types: placeholder as Registry['sessions.targets.store']['types'],
  },
  'sessions.targets.action': {
    methods: ["POST"],
    pattern: '/sessions/:id/targets/:targetId/:action',
    tokens: [{"old":"/sessions/:id/targets/:targetId/:action","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/targets/:targetId/:action","type":1,"val":"id","end":""},{"old":"/sessions/:id/targets/:targetId/:action","type":0,"val":"targets","end":""},{"old":"/sessions/:id/targets/:targetId/:action","type":1,"val":"targetId","end":""},{"old":"/sessions/:id/targets/:targetId/:action","type":1,"val":"action","end":""}],
    types: placeholder as Registry['sessions.targets.action']['types'],
  },
  'sessions.queues': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/queues',
    tokens: [{"old":"/sessions/:id/queues","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/queues","type":1,"val":"id","end":""},{"old":"/sessions/:id/queues","type":0,"val":"queues","end":""}],
    types: placeholder as Registry['sessions.queues']['types'],
  },
  'sessions.queues.cb.cancel': {
    methods: ["POST"],
    pattern: '/sessions/:id/queues/cb/:cbId/cancel',
    tokens: [{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":1,"val":"id","end":""},{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":0,"val":"queues","end":""},{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":0,"val":"cb","end":""},{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":1,"val":"cbId","end":""},{"old":"/sessions/:id/queues/cb/:cbId/cancel","type":0,"val":"cancel","end":""}],
    types: placeholder as Registry['sessions.queues.cb.cancel']['types'],
  },
  'sessions.queues.inbox.resolve': {
    methods: ["POST"],
    pattern: '/sessions/:id/queues/inbox/:itemId/resolve',
    tokens: [{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":1,"val":"id","end":""},{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":0,"val":"queues","end":""},{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":0,"val":"inbox","end":""},{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":1,"val":"itemId","end":""},{"old":"/sessions/:id/queues/inbox/:itemId/resolve","type":0,"val":"resolve","end":""}],
    types: placeholder as Registry['sessions.queues.inbox.resolve']['types'],
  },
  'sessions.queues.ack.clear': {
    methods: ["POST"],
    pattern: '/sessions/:id/queues/ack/clear',
    tokens: [{"old":"/sessions/:id/queues/ack/clear","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/queues/ack/clear","type":1,"val":"id","end":""},{"old":"/sessions/:id/queues/ack/clear","type":0,"val":"queues","end":""},{"old":"/sessions/:id/queues/ack/clear","type":0,"val":"ack","end":""},{"old":"/sessions/:id/queues/ack/clear","type":0,"val":"clear","end":""}],
    types: placeholder as Registry['sessions.queues.ack.clear']['types'],
  },
  'notifications.index': {
    methods: ["GET","HEAD"],
    pattern: '/notifications',
    tokens: [{"old":"/notifications","type":0,"val":"notifications","end":""}],
    types: placeholder as Registry['notifications.index']['types'],
  },
  'act.card': {
    methods: ["GET","HEAD"],
    pattern: '/act/card/:id',
    tokens: [{"old":"/act/card/:id","type":0,"val":"act","end":""},{"old":"/act/card/:id","type":0,"val":"card","end":""},{"old":"/act/card/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['act.card']['types'],
  },
  'act.v1': {
    methods: ["GET","HEAD"],
    pattern: '/act/v1/:token',
    tokens: [{"old":"/act/v1/:token","type":0,"val":"act","end":""},{"old":"/act/v1/:token","type":0,"val":"v1","end":""},{"old":"/act/v1/:token","type":1,"val":"token","end":""}],
    types: placeholder as Registry['act.v1']['types'],
  },
  'sessions.terminals': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/terminals',
    tokens: [{"old":"/sessions/:id/terminals","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/terminals","type":1,"val":"id","end":""},{"old":"/sessions/:id/terminals","type":0,"val":"terminals","end":""}],
    types: placeholder as Registry['sessions.terminals']['types'],
  },
  'sessions.terminals.capture': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/terminals/capture',
    tokens: [{"old":"/sessions/:id/terminals/capture","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/terminals/capture","type":1,"val":"id","end":""},{"old":"/sessions/:id/terminals/capture","type":0,"val":"terminals","end":""},{"old":"/sessions/:id/terminals/capture","type":0,"val":"capture","end":""}],
    types: placeholder as Registry['sessions.terminals.capture']['types'],
  },
  'sessions.terminals.send': {
    methods: ["POST"],
    pattern: '/sessions/:id/terminals/send',
    tokens: [{"old":"/sessions/:id/terminals/send","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/terminals/send","type":1,"val":"id","end":""},{"old":"/sessions/:id/terminals/send","type":0,"val":"terminals","end":""},{"old":"/sessions/:id/terminals/send","type":0,"val":"send","end":""}],
    types: placeholder as Registry['sessions.terminals.send']['types'],
  },
  'sessions.config': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/config',
    tokens: [{"old":"/sessions/:id/config","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/config","type":1,"val":"id","end":""},{"old":"/sessions/:id/config","type":0,"val":"config","end":""}],
    types: placeholder as Registry['sessions.config']['types'],
  },
  'sessions.config.update': {
    methods: ["POST"],
    pattern: '/sessions/:id/config',
    tokens: [{"old":"/sessions/:id/config","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/config","type":1,"val":"id","end":""},{"old":"/sessions/:id/config","type":0,"val":"config","end":""}],
    types: placeholder as Registry['sessions.config.update']['types'],
  },
  'sessions.ops': {
    methods: ["GET","HEAD"],
    pattern: '/sessions/:id/ops',
    tokens: [{"old":"/sessions/:id/ops","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/ops","type":1,"val":"id","end":""},{"old":"/sessions/:id/ops","type":0,"val":"ops","end":""}],
    types: placeholder as Registry['sessions.ops']['types'],
  },
  'sessions.ops.inboxRestart': {
    methods: ["POST"],
    pattern: '/sessions/:id/ops/inbox-restart',
    tokens: [{"old":"/sessions/:id/ops/inbox-restart","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/ops/inbox-restart","type":1,"val":"id","end":""},{"old":"/sessions/:id/ops/inbox-restart","type":0,"val":"ops","end":""},{"old":"/sessions/:id/ops/inbox-restart","type":0,"val":"inbox-restart","end":""}],
    types: placeholder as Registry['sessions.ops.inboxRestart']['types'],
  },
  'sessions.ops.func': {
    methods: ["POST"],
    pattern: '/sessions/:id/ops/func',
    tokens: [{"old":"/sessions/:id/ops/func","type":0,"val":"sessions","end":""},{"old":"/sessions/:id/ops/func","type":1,"val":"id","end":""},{"old":"/sessions/:id/ops/func","type":0,"val":"ops","end":""},{"old":"/sessions/:id/ops/func","type":0,"val":"func","end":""}],
    types: placeholder as Registry['sessions.ops.func']['types'],
  },
  'mds.index': {
    methods: ["GET","HEAD"],
    pattern: '/mds',
    tokens: [{"old":"/mds","type":0,"val":"mds","end":""}],
    types: placeholder as Registry['mds.index']['types'],
  },
  'mds.show': {
    methods: ["GET","HEAD"],
    pattern: '/mds/:sessionId/*',
    tokens: [{"old":"/mds/:sessionId/*","type":0,"val":"mds","end":""},{"old":"/mds/:sessionId/*","type":1,"val":"sessionId","end":""},{"old":"/mds/:sessionId/*","type":2,"val":"*","end":""}],
    types: placeholder as Registry['mds.show']['types'],
  },
  'tools.index': {
    methods: ["GET","HEAD"],
    pattern: '/tools',
    tokens: [{"old":"/tools","type":0,"val":"tools","end":""}],
    types: placeholder as Registry['tools.index']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
