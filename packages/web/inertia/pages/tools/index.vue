<script setup lang="ts">
import { Head } from '@inertiajs/vue3'

defineProps<{
  version: string
  hubPort: number
  host: string
  openLan: boolean
  lanIp: string | null
  phoneUrl: string | null
  qrUrl: string | null
  note: string
  recipes: Array<{ title: string; cmd: string }>
  sessions: Array<{
    id: string
    label: string
    daemonPort: number
    daemonUp: boolean | null
  }>
}>()
</script>

<template>
  <Head title="Tools" />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">Tools</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
    <p class="mt-2 text-xs text-zinc-400 sm-num" translate="no">
      seatmesh@{{ version }} · hub {{ host }}:{{ hubPort }}
    </p>
  </header>

  <div class="mb-4 sm-panel p-4 flex flex-col sm:flex-row gap-4 items-start">
    <div class="min-w-0 flex-1 space-y-2">
      <h2 class="text-sm font-semibold text-zinc-900">Phone / LAN</h2>
      <p v-if="phoneUrl" class="text-sm text-zinc-600 text-pretty">
        Hub is open on LAN. Scan QR or open
        <a :href="phoneUrl" class="text-primary-700 underline sm-mono" translate="no">{{ phoneUrl }}</a>
      </p>
      <p v-else class="text-sm text-zinc-600 text-pretty">
        Bound to <code class="sm-mono text-xs" translate="no">{{ host }}</code>. For phone access restart with
        <code class="sm-mono text-xs">HOST=0.0.0.0 SEATMESH_HUB_OPEN=1</code>
        <span v-if="lanIp">
          — LAN IP looks like
          <span class="sm-mono text-xs" translate="no">{{ lanIp }}:{{ hubPort }}</span>
        </span>
      </p>
    </div>
    <img
      v-if="qrUrl"
      :src="qrUrl"
      width="180"
      height="180"
      alt="QR code for hub phone URL"
      class="rounded-lg border border-zinc-200 bg-white p-2 shrink-0"
    />
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <div class="sm-panel">
      <h2 class="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Recipes</h2>
      <ul class="divide-y divide-zinc-50">
        <li v-for="r in recipes" :key="r.title" class="px-4 py-3">
          <div class="text-sm font-medium text-zinc-900">{{ r.title }}</div>
          <code class="mt-1 block text-xs text-primary-700 sm-mono break-all" translate="no">{{ r.cmd }}</code>
        </li>
      </ul>
    </div>

    <div class="sm-panel">
      <h2 class="border-b border-zinc-100 px-4 py-3 text-sm font-semibold">Sessions → Ops</h2>
      <ul v-if="sessions.length" class="divide-y divide-zinc-50">
        <li v-for="s in sessions" :key="s.id">
          <ULink
            :to="`/sessions/${s.id}/ops`"
            class="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-zinc-50"
          >
            <span class="font-medium" translate="no">{{ s.label }}</span>
            <div class="flex items-center gap-2">
              <UBadge :color="s.daemonUp ? 'success' : 'error'" variant="subtle" size="sm" translate="no">
                :{{ s.daemonPort }}
              </UBadge>
              <span class="text-xs text-zinc-400">restart · funcs</span>
            </div>
          </ULink>
        </li>
      </ul>
      <p v-else class="px-4 py-8 text-center text-sm text-zinc-400">No sessions in registry.</p>
    </div>
  </div>
</template>
