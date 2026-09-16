/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['index']>>>
    }
  }
  'sessions.index': {
    methods: ["GET","HEAD"]
    pattern: '/sessions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/mesh_sessions_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/mesh_sessions_controller').default['index']>>>
    }
  }
  'sessions.show': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/mesh_sessions_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/mesh_sessions_controller').default['show']>>>
    }
  }
  'sessions.tasks': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/tasks'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/tasks_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/tasks_controller').default['index']>>>
    }
  }
  'sessions.notifications': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/notifications'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_notifications_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_notifications_controller').default['index']>>>
    }
  }
  'sessions.targets': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/targets'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['index']>>>
    }
  }
  'sessions.targets.store': {
    methods: ["POST"]
    pattern: '/sessions/:id/targets'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['store']>>>
    }
  }
  'sessions.targets.action': {
    methods: ["POST"]
    pattern: '/sessions/:id/targets/:targetId/:action'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { id: ParamValue; targetId: ParamValue; action: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['action']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/targets_controller').default['action']>>>
    }
  }
  'sessions.queues': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/queues'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['index']>>>
    }
  }
  'sessions.queues.cb.cancel': {
    methods: ["POST"]
    pattern: '/sessions/:id/queues/cb/:cbId/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; cbId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['cancelCb']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['cancelCb']>>>
    }
  }
  'sessions.queues.inbox.resolve': {
    methods: ["POST"]
    pattern: '/sessions/:id/queues/inbox/:itemId/resolve'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; itemId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['resolveInboxItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['resolveInboxItem']>>>
    }
  }
  'sessions.queues.ack.clear': {
    methods: ["POST"]
    pattern: '/sessions/:id/queues/ack/clear'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['clearAck']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queues_controller').default['clearAck']>>>
    }
  }
  'notifications.index': {
    methods: ["GET","HEAD"]
    pattern: '/notifications'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['index']>>>
    }
  }
  'act.card': {
    methods: ["GET","HEAD"]
    pattern: '/act/card/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/act_cards_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/act_cards_controller').default['show']>>>
    }
  }
  'act.v1': {
    methods: ["GET","HEAD"]
    pattern: '/act/v1/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/act_cards_controller').default['act']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/act_cards_controller').default['act']>>>
    }
  }
  'sessions.terminals': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/terminals'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['index']>>>
    }
  }
  'sessions.terminals.capture': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/terminals/capture'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['capture']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['capture']>>>
    }
  }
  'sessions.terminals.send': {
    methods: ["POST"]
    pattern: '/sessions/:id/terminals/send'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['send']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/terminals_controller').default['send']>>>
    }
  }
  'sessions.config': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/config'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/config_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/config_controller').default['show']>>>
    }
  }
  'sessions.config.update': {
    methods: ["POST"]
    pattern: '/sessions/:id/config'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/config_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/config_controller').default['update']>>>
    }
  }
  'sessions.ops': {
    methods: ["GET","HEAD"]
    pattern: '/sessions/:id/ops'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['show']>>>
    }
  }
  'sessions.ops.inboxRestart': {
    methods: ["POST"]
    pattern: '/sessions/:id/ops/inbox-restart'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['restartInbox']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['restartInbox']>>>
    }
  }
  'sessions.ops.func': {
    methods: ["POST"]
    pattern: '/sessions/:id/ops/func'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['runFunc']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_ops_controller').default['runFunc']>>>
    }
  }
  'mds.index': {
    methods: ["GET","HEAD"]
    pattern: '/mds'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/mds_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/mds_controller').default['index']>>>
    }
  }
  'tools.index': {
    methods: ["GET","HEAD"]
    pattern: '/tools'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/tools_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/tools_controller').default['index']>>>
    }
  }
}
