import './css/app.css'
import { client } from '~/client'
import Layout from '~/layouts/default.vue'
import { createInertiaApp, router } from '@inertiajs/vue3'
import { TuyauProvider } from '@adonisjs/inertia/vue'
import { createApp, type DefineComponent, h } from 'vue'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import ui from '@nuxt/ui/vue-plugin'
import { plugin as formkit, defaultConfig } from '@formkit/vue'
import '@formkit/themes/genesis'

const appName = import.meta.env.VITE_APP_NAME || 'seatmesh'

// Drop stale async reloads when starting a real navigation (seamless hops).
router.on('before', (event) => {
  const visit = event.detail.visit
  if (visit.prefetch) return
  router.cancelAll({ prefetch: false, async: true, sync: false })
})

createInertiaApp({
  title: (title) => (title ? `${title} · ${appName}` : appName),
  resolve: (name) => {
    return resolvePageComponent(
      `./pages/${name}.vue`,
      import.meta.glob<DefineComponent>('./pages/**/*.vue'),
      Layout
    )
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(TuyauProvider, { client }, { default: () => h(App, props) }) })
      .use(plugin)
      .use(ui)
      .use(formkit, defaultConfig)
      .mount(el)
  },
  progress: {
    color: '#22c55e',
    delay: 80,
    includeCSS: true,
    showSpinner: false,
  },
})
