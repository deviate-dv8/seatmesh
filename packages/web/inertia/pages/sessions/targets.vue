<script setup lang="ts">
import { Head, useForm, router } from '@inertiajs/vue3'
import SessionChrome from '~/components/SessionChrome.vue'

const props = defineProps<{
  id: string
  all: boolean
  error: string | null
  session: {
    id: string
    label: string
    daemonPort: number
    daemonUp: boolean | null
  }
  targets: Array<{
    id: string
    status: string
    goal: string
    deadlineAt: string
    kind?: string
    parentId?: string
  }>
}>()

const form = useForm({
  goal: '',
  deadline: 'eod',
  kind: 'scope',
  parentId: '',
})

function submit() {
  form.post(`/sessions/${props.session.id}/targets`, { preserveScroll: true })
}

function act(targetId: string, action: string) {
  router.post(`/sessions/${props.session.id}/targets/${targetId}/${action}`, {}, { preserveScroll: true })
}

function fmtWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
</script>

<template>
  <Head :title="`Targets · ${session.label}`" />

  <SessionChrome
    :session-id="session.id"
    :label="session.label"
    :daemon-port="session.daemonPort"
    :daemon-up="session.daemonUp"
    active="targets"
  />

  <header class="mb-4">
    <h1 class="font-display text-3xl font-bold tracking-tight">Targets</h1>
    <p class="mt-1 text-muted">
      Daemon <code class="sm-mono" translate="no">/targets</code> on
      <span class="sm-mono sm-num" translate="no">:{{ session.daemonPort }}</span>
      · Phase&nbsp;2
    </p>
  </header>

  <UAlert v-if="error" color="error" variant="subtle" class="mb-4" :title="error" />

  <UCard class="mb-4">
    <template #header><h2 class="font-semibold">Add Target</h2></template>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="submit">
      <UFormField label="Goal" class="min-w-[12rem] flex-1">
        <UInput
          v-model="form.goal"
          name="goal"
          autocomplete="off"
          :spellcheck="false"
          placeholder="finish remaining s13 tickets…"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField label="Deadline">
        <UInput
          v-model="form.deadline"
          name="deadline"
          autocomplete="off"
          :spellcheck="false"
          placeholder="eod | 6h…"
          class="w-28"
        />
      </UFormField>
      <UFormField label="Kind">
        <USelect
          v-model="form.kind"
          name="kind"
          :items="[
            { label: 'scope (whole goal)', value: 'scope' },
            { label: 'slice (under scope)', value: 'slice' },
          ]"
          class="w-44"
        />
      </UFormField>
      <UFormField v-if="form.kind === 'slice'" label="Parent">
        <UInput
          v-model="form.parentId"
          name="parentId"
          autocomplete="off"
          :spellcheck="false"
          placeholder="tgt-…"
          class="w-40"
        />
      </UFormField>
      <UButton type="submit" color="primary" :loading="form.processing">
        {{ form.processing ? 'Adding…' : 'Add Target' }}
      </UButton>
    </form>
  </UCard>

  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header><h2 class="font-semibold">Active</h2></template>
    <div v-if="targets.length" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-elevated/50 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-2.5 font-semibold">Goal</th>
            <th class="px-4 py-2.5 font-semibold">Kind</th>
            <th class="px-4 py-2.5 font-semibold">Due</th>
            <th class="px-4 py-2.5 font-semibold">Status</th>
            <th class="px-4 py-2.5 font-semibold"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in targets" :key="row.id" class="border-t border-default">
            <td class="px-4 py-2.5 break-words">{{ row.goal }}</td>
            <td class="px-4 py-2.5">{{ row.kind || (row.parentId ? 'slice' : 'scope') }}</td>
            <td class="px-4 py-2.5 sm-num">{{ fmtWhen(row.deadlineAt) }}</td>
            <td class="px-4 py-2.5">{{ row.status }}</td>
            <td class="px-4 py-2.5">
              <div v-if="row.status === 'active'" class="flex flex-wrap justify-end gap-1">
                <UButton size="xs" color="neutral" variant="ghost" @click="act(row.id, 'triage')">
                  Triage
                </UButton>
                <UButton size="xs" color="neutral" variant="ghost" @click="act(row.id, 'done')">Done</UButton>
                <UButton size="xs" color="error" variant="ghost" @click="act(row.id, 'cancel')">
                  Cancel
                </UButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="p-8 text-center text-muted">No targets.</p>
  </UCard>
</template>
