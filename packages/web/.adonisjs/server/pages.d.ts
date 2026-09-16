import '@adonisjs/inertia/types'

import type { VNodeProps, AllowedComponentProps, ComponentInstance } from 'vue'

type ExtractProps<T> = Omit<
  ComponentInstance<T>['$props'],
  keyof VNodeProps | keyof AllowedComponentProps
>

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'dashboard': ExtractProps<(typeof import('../../inertia/pages/dashboard.vue'))['default']>
    'act/card': ExtractProps<(typeof import('../../inertia/pages/act/card.vue'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.vue'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.vue'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.vue'))['default']>
    'auth/signup': ExtractProps<(typeof import('../../inertia/pages/auth/signup.vue'))['default']>
    'mds/index': ExtractProps<(typeof import('../../inertia/pages/mds/index.vue'))['default']>
    'notifications/index': ExtractProps<(typeof import('../../inertia/pages/notifications/index.vue'))['default']>
    'sessions/config': ExtractProps<(typeof import('../../inertia/pages/sessions/config.vue'))['default']>
    'sessions/index': ExtractProps<(typeof import('../../inertia/pages/sessions/index.vue'))['default']>
    'sessions/notifications': ExtractProps<(typeof import('../../inertia/pages/sessions/notifications.vue'))['default']>
    'sessions/ops': ExtractProps<(typeof import('../../inertia/pages/sessions/ops.vue'))['default']>
    'sessions/queues': ExtractProps<(typeof import('../../inertia/pages/sessions/queues.vue'))['default']>
    'sessions/show': ExtractProps<(typeof import('../../inertia/pages/sessions/show.vue'))['default']>
    'sessions/targets': ExtractProps<(typeof import('../../inertia/pages/sessions/targets.vue'))['default']>
    'sessions/tasks': ExtractProps<(typeof import('../../inertia/pages/sessions/tasks.vue'))['default']>
    'sessions/terminals': ExtractProps<(typeof import('../../inertia/pages/sessions/terminals.vue'))['default']>
    'tools/index': ExtractProps<(typeof import('../../inertia/pages/tools/index.vue'))['default']>
  }
}
