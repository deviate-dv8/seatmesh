<script setup lang="ts">
import { Head } from '@inertiajs/vue3'

defineProps<{
  note: string
  items: Array<{ title: string; url: string; when: string }>
}>()
</script>

<template>
  <Head title="Hosted MDs" />

  <header class="mb-5">
    <h1 class="font-display text-3xl font-bold tracking-tight">Hosted MDs</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
  </header>

  <div class="sm-panel px-4 py-10 text-center text-sm text-zinc-500">
    <p v-if="!items.length">No hosted previews yet. Try <code class="sm-mono text-primary-700" translate="no">seatmesh agent preview &lt;file.md&gt;</code>.</p>
  </div>
</template>
