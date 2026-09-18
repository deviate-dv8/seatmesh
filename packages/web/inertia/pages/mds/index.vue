<script setup lang="ts">
import { computed } from 'vue'
import { Head, Link } from '@inertiajs/vue3'

type Item = {
  title: string
  url: string
  when: string
  mesh?: string
  slug?: string
  sessionId?: string
}

const props = defineProps<{
  note: string
  items: Item[]
}>()

type Group = { id: string; label: string; blurb: string; items: Item[] }

function groupId(slug: string | undefined): string {
  const s = slug || ''
  if (s === 'INDEX' || s === 'contracts-easy' || s === 'oldest-clis-and-layout' || s === 'hosted-mds-hello') {
    return 'guides'
  }
  if (s.startsWith('docs/cli/')) return 'cli'
  if (s.startsWith('docs/patterns/')) return 'patterns'
  if (s.startsWith('docs/releases/')) return 'releases'
  if (s.startsWith('docs/')) return 'concepts'
  return 'other'
}

const GROUP_META: Record<string, { label: string; blurb: string; order: number }> = {
  guides: { label: 'Guides', blurb: 'Start here — job-grouped, not A–Z', order: 0 },
  concepts: { label: 'Concepts', blurb: 'Architecture, config, dotdir, storage…', order: 1 },
  cli: { label: 'CLI stubs', blurb: 'Per-verb files — prefer INDEX / ONE-PATH first', order: 2 },
  patterns: { label: 'Patterns', blurb: 'Modular how-tos', order: 3 },
  releases: { label: 'Releases', blurb: 'Version notes', order: 4 },
  other: { label: 'Other', blurb: '', order: 5 },
}

const groups = computed((): Group[] => {
  const map = new Map<string, Item[]>()
  for (const it of props.items) {
    const id = groupId(it.slug)
    if (!map.has(id)) map.set(id, [])
    map.get(id)!.push(it)
  }
  // Guides: INDEX first
  const guides = map.get('guides') || []
  guides.sort((a, b) => {
    if (a.slug === 'INDEX') return -1
    if (b.slug === 'INDEX') return 1
    return (a.title || '').localeCompare(b.title || '')
  })
  map.set('guides', guides)

  for (const [id, list] of map) {
    if (id === 'guides') continue
    list.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''))
  }

  return [...map.entries()]
    .map(([id, items]) => ({
      id,
      label: GROUP_META[id]?.label || id,
      blurb: GROUP_META[id]?.blurb || '',
      items,
      order: GROUP_META[id]?.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ id, label, blurb, items }) => ({ id, label, blurb, items }))
})

function pathOf(url: string) {
  return url.replace(/^https?:\/\/[^/]+/, '')
}

const indexHref = computed(() => {
  const hit = props.items.find((i) => i.slug === 'INDEX')
  if (hit) return pathOf(hit.url)
  const sid = props.items[0]?.sessionId
  return sid ? `/mds/${encodeURIComponent(sid)}/INDEX` : '/mds'
})
</script>

<template>
  <Head title="Hosted MDs" />

  <header class="mb-6">
    <h1 class="font-display text-3xl font-bold tracking-tight">Hosted MDs</h1>
    <p class="mt-1 text-zinc-500 text-pretty">{{ note }}</p>
    <p class="mt-2 text-sm">
      <Link :href="indexHref" class="text-primary-700 font-medium hover:underline">
        Open INDEX (job-grouped guide)
      </Link>
    </p>
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

  <div v-else class="space-y-8">
    <section v-for="g in groups" :key="g.id">
      <header class="mb-3">
        <h2 class="font-display text-lg font-semibold text-zinc-900">{{ g.label }}</h2>
        <p v-if="g.blurb" class="text-xs text-zinc-500">{{ g.blurb }} · {{ g.items.length }}</p>
      </header>
      <ul class="space-y-1.5">
        <li
          v-for="it in g.items"
          :key="`${it.sessionId}:${it.slug}`"
          class="sm-panel px-3.5 py-2.5"
        >
          <Link :href="pathOf(it.url)" class="font-medium text-primary-800 hover:underline">
            {{ it.title }}
          </Link>
          <p class="mt-0.5 text-[0.7rem] text-zinc-400 sm-num" translate="no">
            {{ it.slug }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
