<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    ariaHidden?: boolean
  }>(),
  { size: 'md', ariaHidden: true }
)

/** Inline SVG — Vite cannot resolve /public absolute paths as imports. */
const px = computed(() => {
  if (props.size === 'sm') return 28
  if (props.size === 'lg') return 64
  return 40
})
</script>

<template>
  <svg
    class="sm-mark inline-block shrink-0 select-none"
    viewBox="0 0 64 64"
    :width="px"
    :height="px"
    role="img"
    aria-label="seatmesh"
    :aria-hidden="ariaHidden ? 'true' : undefined"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <clipPath :id="`sm-t-${size}`">
        <polygon points="4,4 60,4 32,60" />
      </clipPath>
    </defs>
    <g :clip-path="`url(#sm-t-${size})`">
      <rect x="0" y="0" width="64" height="16" fill="#86efac" />
      <rect x="0" y="16" width="64" height="16" fill="#4ade80" />
      <rect x="0" y="32" width="64" height="16" fill="#22c55e" />
      <rect x="0" y="48" width="64" height="16" fill="#16a34a" />
    </g>
  </svg>
</template>
