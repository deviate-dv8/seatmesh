<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import type { Data } from '@generated/data'
import SeatmeshMark from '~/components/SeatmeshMark.vue'
import { useInboxRestartQueue } from '~/composables/useInboxRestartQueue'

const page = usePage<Data.SharedProps>()
const toast = useToast()
const { pendingCount } = useInboxRestartQueue()
const mobileOpen = ref(false)

watch(
  () => page.flash,
  (flashMessages) => {
    if (flashMessages?.error) {
      toast.add({ title: 'Error', description: flashMessages.error, color: 'error' })
    }
    if (flashMessages?.success) {
      toast.add({ title: 'OK', description: flashMessages.success, color: 'success' })
    }
  },
  { immediate: true }
)

watch(
  () => page.url,
  () => {
    mobileOpen.value = false
  }
)

const path = computed(() => page.url.split('?')[0] || '/')

const nav = [
  { label: 'Dashboard', to: '/', match: (p: string) => p === '/' },
  { label: 'Sessions', to: '/sessions', match: (p: string) => p.startsWith('/sessions') },
  { label: 'Notifications', to: '/notifications', match: (p: string) => p.startsWith('/notifications') },
  { label: 'Hosted MDs', to: '/mds', match: (p: string) => p.startsWith('/mds') },
  { label: 'Tools', to: '/tools', match: (p: string) => p.startsWith('/tools') },
]

function navClass(active: boolean) {
  return active
    ? 'bg-zinc-900/5 text-zinc-900'
    : 'text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-900'
}
</script>

<template>
  <UApp :toaster="{ position: 'top-center' }">
    <a
      class="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      href="#main"
    >
      Skip to content
    </a>

    <div class="sm-shell">
      <header
        class="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md pt-[env(safe-area-inset-top)]"
      >
        <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <UButton
            class="md:hidden shrink-0"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            aria-label="Open menu"
            @click="mobileOpen = true"
          >
            <span class="flex flex-col gap-1" aria-hidden="true">
              <span class="block h-0.5 w-4 rounded-full bg-zinc-700" />
              <span class="block h-0.5 w-4 rounded-full bg-zinc-700" />
              <span class="block h-0.5 w-4 rounded-full bg-zinc-700" />
            </span>
          </UButton>

          <ULink to="/" prefetch="hover" class="flex items-center gap-2 min-w-0 group" aria-label="seatmesh home">
            <SeatmeshMark size="sm" class="shrink-0 opacity-95 group-hover:opacity-100 transition-opacity" />
            <span
              class="font-display text-[1.25rem] sm:text-[1.35rem] font-bold tracking-tight text-zinc-900 group-hover:text-primary-600 transition-colors"
              translate="no"
            >
              seatmesh
            </span>
          </ULink>

          <nav class="hidden md:flex flex-1 items-center gap-1 min-w-0" aria-label="Primary">
            <ULink
              v-for="item in nav"
              :key="item.to"
              :to="item.to"
              prefetch="hover"
              class="rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
              :class="navClass(item.match(path))"
            >
              {{ item.label }}
            </ULink>
          </nav>

          <div class="ml-auto flex items-center gap-2 shrink-0">
            <UBadge
              v-if="pendingCount > 0"
              color="primary"
              variant="solid"
              class="sm-num animate-pulse"
              :title="`${pendingCount} inbox restart(s) in progress`"
            >
              {{ pendingCount }} restarting
            </UBadge>
            <UBadge color="primary" variant="subtle" class="sm-num hidden sm:inline-flex" translate="no">
              :3190
            </UBadge>
          </div>
        </div>
      </header>

      <UDrawer v-model:open="mobileOpen" direction="left" :handle="false" :ui="{ content: 'max-w-[min(18rem,88vw)] w-full' }">
        <template #content>
          <div class="flex h-full flex-col bg-white pt-[env(safe-area-inset-top)]">
            <div class="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
              <div class="flex items-center gap-2 min-w-0">
                <SeatmeshMark size="sm" />
                <span class="font-display font-bold text-zinc-900" translate="no">seatmesh</span>
              </div>
              <UButton color="neutral" variant="ghost" size="sm" @click="mobileOpen = false">Close</UButton>
            </div>
            <nav class="flex flex-col gap-0.5 p-3" aria-label="Mobile">
              <ULink
                v-for="item in nav"
                :key="item.to"
                :to="item.to"
                prefetch="hover"
                class="rounded-lg px-3 py-3 text-base font-medium transition-colors"
                :class="navClass(item.match(path))"
                @click="mobileOpen = false"
              >
                {{ item.label }}
              </ULink>
            </nav>
            <p class="mt-auto px-4 py-4 text-xs text-zinc-400 sm-num" translate="no">hub :3190</p>
          </div>
        </template>
      </UDrawer>
      <main
        id="main"
        class="mx-auto w-full max-w-6xl flex-1 px-3 py-6 sm:px-4 sm:py-10 scroll-mt-20 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <slot />
      </main>

      <footer
        class="mx-auto flex w-full max-w-6xl flex-wrap gap-x-2 gap-y-1 px-3 py-4 text-xs text-zinc-500 sm:px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <span>Operator console</span>
        <span aria-hidden="true">·</span>
        <span>AdonisJS 7 · Nuxt UI</span>
        <span aria-hidden="true">·</span>
        <span>blocks 1.2.x</span>
      </footer>
    </div>
  </UApp>
</template>
