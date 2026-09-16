<script setup lang="ts">
import { reactive, ref, toRaw } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import type { FormKitNode } from '@formkit/core'
import SessionChrome from '~/components/SessionChrome.vue'

type FormValues = {
  name: string
  session: { name: string; workerCount: number; miniMax: number }
  daemon: { port: number; pollMs: number; autoStart: boolean }
  ports: { worker: string }
  layout: {
    workers: { grid: string; slots: number; enabled: boolean }
    minis: { grid: string; max: number; enabled: boolean }
    logs: { enabled: boolean }
  }
}

const props = defineProps<{
  id: string
  note: string
  session: {
    id: string
    label: string
    profilePath: string
    workspace: string
    daemonPort: number
  }
  form: FormValues | null
  rawYaml: string
  error: string | null
}>()

const tab = ref<'form' | 'yaml'>('form')
const saving = ref(false)

const values = reactive<FormValues>(
  props.form
    ? structuredClone(toRaw(props.form) as FormValues)
    : {
        name: '',
        session: { name: 'mesh', workerCount: 6, miniMax: 8 },
        daemon: { port: 3100, pollMs: 4000, autoStart: true },
        ports: { worker: '30{n}0/30{n}1' },
        layout: {
          workers: { grid: '3x2', slots: 6, enabled: true },
          minis: { grid: '4x2', max: 8, enabled: true },
          logs: { enabled: true },
        },
      }
)

function onSubmit(_data: FormValues, node?: FormKitNode) {
  saving.value = true
  router.post(
    `/sessions/${props.session.id}/config`,
    { ...values },
    {
      preserveScroll: true,
      onFinish: () => {
        saving.value = false
        node?.clearErrors()
      },
    }
  )
}
</script>

<template>
  <Head :title="`Config · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="true"
    active="config"
  />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">Config</h1>
    <p class="mt-1 text-sm text-zinc-500 text-pretty">{{ note }}</p>
    <p class="mt-2 text-xs text-zinc-400 sm-mono break-all" translate="no">{{ session.profilePath }}</p>
  </header>

  <p v-if="error" class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
    {{ error }}
  </p>

  <div class="mb-4 flex flex-wrap gap-2">
    <UButton
      size="sm"
      :color="tab === 'form' ? 'primary' : 'neutral'"
      :variant="tab === 'form' ? 'solid' : 'outline'"
      @click="tab = 'form'"
    >
      Form
    </UButton>
    <UButton
      size="sm"
      :color="tab === 'yaml' ? 'primary' : 'neutral'"
      :variant="tab === 'yaml' ? 'solid' : 'outline'"
      @click="tab = 'yaml'"
    >
      Raw YAML
    </UButton>
  </div>

  <div v-show="tab === 'yaml'" class="sm-panel">
    <pre class="max-h-[70vh] overflow-auto p-4 text-xs leading-relaxed text-zinc-700 sm-mono whitespace-pre" translate="no">{{ rawYaml || '(empty)' }}</pre>
  </div>

  <div v-show="tab === 'form'" class="sm-panel p-4 sm:p-6">
    <FormKit
      v-if="form"
      v-model="values"
      type="form"
      :actions="false"
      @submit="onSubmit"
    >
      <div class="grid gap-6 lg:grid-cols-2">
        <section class="space-y-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Profile</h2>
          <FormKit type="text" name="name" label="Name" validation="required" />
          <FormKit type="text" name="session.name" label="Session name prefix" help="tmux session base name" />
          <FormKit
            type="number"
            name="session.workerCount"
            label="Worker count"
            validation="required|min:1|max:32"
            number="integer"
          />
          <FormKit
            type="number"
            name="session.miniMax"
            label="Mini max"
            validation="required|min:1|max:16"
            number="integer"
          />
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Daemon</h2>
          <FormKit
            type="number"
            name="daemon.port"
            label="Port"
            validation="required|min:1024|max:65535"
            number="integer"
            help="Needs inbox restart after change"
          />
          <FormKit
            type="number"
            name="daemon.pollMs"
            label="Poll ms"
            validation="required|min:500"
            number="integer"
          />
          <FormKit type="checkbox" name="daemon.autoStart" label="Auto-start inbox" />
          <FormKit
            type="text"
            name="ports.worker"
            label="Worker ports pattern"
            help="e.g. 30{n}0/30{n}1"
          />
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Workers layout</h2>
          <FormKit type="text" name="layout.workers.grid" label="Grid" help="e.g. 3x2" />
          <FormKit type="number" name="layout.workers.slots" label="Slots" number="integer" />
          <FormKit type="checkbox" name="layout.workers.enabled" label="Enabled" />
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Minis · Logs</h2>
          <FormKit type="text" name="layout.minis.grid" label="Minis grid" />
          <FormKit type="number" name="layout.minis.max" label="Minis max" number="integer" />
          <FormKit type="checkbox" name="layout.minis.enabled" label="Minis enabled" />
          <FormKit type="checkbox" name="layout.logs.enabled" label="Logs window enabled" />
        </section>
      </div>

      <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
        <UButton type="submit" color="primary" :loading="saving">Save config</UButton>
        <p class="text-xs text-zinc-500">
          Writes <code class="sm-mono text-primary-700">mesh.config.yaml</code> with backup +
          <code class="sm-mono">MeshProfileSchema</code> validation. Layout/port changes may need session reload.
        </p>
      </div>
    </FormKit>
  </div>
</template>

<style>
/* FormKit genesis tuned to seatmesh shell */
.formkit-form {
  --fk-color-primary: #22c55e;
  --fk-border-radius: 0.5rem;
  --fk-font-family-input: inherit;
}
.formkit-outer {
  margin-bottom: 0.75rem;
}
.formkit-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #3f3f46;
}
.formkit-help {
  font-size: 0.7rem;
  color: #a1a1aa;
}
.formkit-input {
  border-color: #e4e4e7 !important;
  background: #fff !important;
}
</style>
