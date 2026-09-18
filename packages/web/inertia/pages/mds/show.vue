<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3'
import MarkdownViewer from '~/components/MarkdownViewer.vue'
import ReaderLayout from '~/layouts/reader.vue'

defineOptions({ layout: ReaderLayout })

defineProps<{
  title: string
  body: string
  slug: string
  mesh: string
  sessionId: string
  file: string
}>()
</script>

<template>
  <Head :title="title" />

  <div class="reader-doc">
    <div class="reader-meta">
      <Link href="/mds" class="text-sm text-zinc-500 hover:text-primary-700">← Hosted MDs</Link>
      <p class="sm-num text-xs text-zinc-400" translate="no">
        {{ mesh }} · {{ file }} · {{ slug }}
      </p>
    </div>

    <MarkdownViewer :source="body" :title="title" />
  </div>
</template>

<style scoped>
.reader-doc {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.reader-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}
</style>
