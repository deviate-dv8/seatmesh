<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'

defineProps<{
  note: string
  items: Array<{
    title: string
    url: string
    when: string
    mesh?: string
    slug?: string
    sessionId?: string
  }>
}>()
</script>

<template>
  <Head title="Hosted MDs" />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">Hosted MDs</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
  </header>

  <div v-if="!items.length" class="sm-panel px-4 py-10 text-center text-sm text-zinc-500">
    <p>
      No hosted MDs yet. Drop
      <code class="sm-mono text-primary-700" translate="no">.md</code>
      under
      <code class="sm-mono text-primary-700" translate="no">.sm/mds/</code>
      or run
      <code class="sm-mono text-primary-700" translate="no">seatmesh agent mds hosted host &lt;file.md&gt;</code>.
    </p>
  </div>

  <ul v-else class="space-y-2">
    <li v-for="it in items" :key="`${it.sessionId}:${it.slug}`" class="sm-panel px-4 py-3">
      <Link :href="it.url.replace(/^https?:\/\/[^/]+/, '')" class="font-medium text-primary-800 hover:underline">
        {{ it.title }}
      </Link>
      <p class="mt-0.5 text-xs text-zinc-500" translate="no">
        {{ it.mesh }} · {{ it.slug }} · {{ it.when?.slice(0, 19) }}
      </p>
    </li>
  </ul>
</template>
