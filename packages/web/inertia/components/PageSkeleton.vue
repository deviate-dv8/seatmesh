<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Short label under the spinner */
    label?: string
    /** Compact inline vs block panel */
    compact?: boolean
    rows?: number
  }>(),
  { label: 'Loading…', compact: false, rows: 4 }
)
</script>

<template>
  <div
    class="flex flex-col gap-3"
    :class="compact ? 'py-4' : 'sm-panel px-4 py-8'"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2 text-sm text-zinc-500">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary-600" />
      <span>{{ label }}</span>
    </div>
    <div v-if="!compact" class="space-y-2" aria-hidden="true">
      <div
        v-for="i in rows"
        :key="i"
        class="h-3 rounded bg-zinc-100 animate-pulse"
        :style="{ width: `${88 - (i % 3) * 12}%` }"
      />
    </div>
  </div>
</template>
