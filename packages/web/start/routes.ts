/*
|--------------------------------------------------------------------------
| Routes — seatmesh operator hub (AdonisJS 7)
| localhost-first: no login (plan §2)
|--------------------------------------------------------------------------
*/

import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

router.get('/', [controllers.Dashboard, 'index']).as('home')
router.get('/sessions', [controllers.MeshSessions, 'index']).as('sessions.index')
router.get('/sessions/:id', [controllers.MeshSessions, 'show']).as('sessions.show')
router.get('/sessions/:id/tasks', [controllers.Tasks, 'index']).as('sessions.tasks')
router
  .get('/sessions/:id/notifications', [controllers.SessionNotifications, 'index'])
  .as('sessions.notifications')
router.get('/sessions/:id/targets', [controllers.Targets, 'index']).as('sessions.targets')
router.post('/sessions/:id/targets', [controllers.Targets, 'store']).as('sessions.targets.store')
router
  .post('/sessions/:id/targets/:targetId/:action', [controllers.Targets, 'action'])
  .as('sessions.targets.action')

router.get('/sessions/:id/queues', [controllers.Queues, 'index']).as('sessions.queues')
router
  .post('/sessions/:id/queues/cb/:cbId/cancel', [controllers.Queues, 'cancelCb'])
  .as('sessions.queues.cb.cancel')
router
  .post('/sessions/:id/queues/inbox/:itemId/resolve', [controllers.Queues, 'resolveInboxItem'])
  .as('sessions.queues.inbox.resolve')
router
  .post('/sessions/:id/queues/ack/clear', [controllers.Queues, 'clearAck'])
  .as('sessions.queues.ack.clear')

router.get('/notifications', [controllers.Notifications, 'index']).as('notifications.index')

router.get('/act/card/:id', [controllers.ActCards, 'show']).as('act.card')
router.get('/act/v1/:token', [controllers.ActCards, 'act']).as('act.v1')

router.get('/sessions/:id/terminals', [controllers.Terminals, 'index']).as('sessions.terminals')
router.get('/sessions/:id/terminals/capture', [controllers.Terminals, 'capture']).as('sessions.terminals.capture')
router.post('/sessions/:id/terminals/send', [controllers.Terminals, 'send']).as('sessions.terminals.send')

router.get('/sessions/:id/config', [controllers.Config, 'show']).as('sessions.config')
router.post('/sessions/:id/config', [controllers.Config, 'update']).as('sessions.config.update')

router.get('/sessions/:id/ops', [controllers.SessionOps, 'show']).as('sessions.ops')
router
  .post('/sessions/:id/ops/inbox-restart', [controllers.SessionOps, 'restartInbox'])
  .as('sessions.ops.inboxRestart')
router.post('/sessions/:id/ops/func', [controllers.SessionOps, 'runFunc']).as('sessions.ops.func')
router.post('/sessions/:id/ops/kill', [controllers.SessionOps, 'kill']).as('sessions.ops.kill')

router.get('/mds', [controllers.Mds, 'index']).as('mds.index')
router.get('/mds/:sessionId/*', [controllers.Mds, 'show']).as('mds.show')
router.get('/tools', [controllers.Tools, 'index']).as('tools.index')
