import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'home': { paramsTuple?: []; params?: {} }
    'sessions.index': { paramsTuple?: []; params?: {} }
    'sessions.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.tasks': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.notifications': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets.action': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'targetId': ParamValue,'action': ParamValue} }
    'sessions.queues': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.queues.cb.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'cbId': ParamValue} }
    'sessions.queues.inbox.resolve': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'itemId': ParamValue} }
    'sessions.queues.ack.clear': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'act.card': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'act.v1': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'sessions.terminals': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.terminals.capture': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.terminals.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.config': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.config.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops.inboxRestart': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops.func': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'mds.index': { paramsTuple?: []; params?: {} }
    'tools.index': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'home': { paramsTuple?: []; params?: {} }
    'sessions.index': { paramsTuple?: []; params?: {} }
    'sessions.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.tasks': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.notifications': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.queues': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'act.card': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'act.v1': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'sessions.terminals': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.terminals.capture': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.config': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'mds.index': { paramsTuple?: []; params?: {} }
    'tools.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'home': { paramsTuple?: []; params?: {} }
    'sessions.index': { paramsTuple?: []; params?: {} }
    'sessions.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.tasks': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.notifications': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.queues': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'act.card': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'act.v1': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'sessions.terminals': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.terminals.capture': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.config': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'mds.index': { paramsTuple?: []; params?: {} }
    'tools.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'sessions.targets.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.targets.action': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'targetId': ParamValue,'action': ParamValue} }
    'sessions.queues.cb.cancel': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'cbId': ParamValue} }
    'sessions.queues.inbox.resolve': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'itemId': ParamValue} }
    'sessions.queues.ack.clear': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.terminals.send': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.config.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops.inboxRestart': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'sessions.ops.func': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}