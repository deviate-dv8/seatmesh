<script setup lang="ts">
import { Link } from '@inertiajs/vue3'
import SeatmeshMark from '~/components/SeatmeshMark.vue'
</script>

<template>
  <UApp>
    <div class="md-reader-shell">
      <header class="md-reader-bar">
        <Link href="/" class="md-reader-brand" aria-label="seatmesh home">
          <SeatmeshMark size="sm" />
          <span translate="no">seatmesh</span>
        </Link>
        <span class="md-reader-eyebrow">Reader</span>
      </header>
      <main class="md-reader-main">
        <slot />
      </main>
    </div>
  </UApp>
</template>

<style scoped>
.md-reader-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(800px 360px at 10% -5%, rgb(34 197 94 / 8%), transparent 55%),
    linear-gradient(180deg, #fafafa 0%, #f4f5f7 40%, #eceef2 100%);
}

.md-reader-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  height: 3rem;
  padding: 0 1rem;
  border-bottom: 1px solid rgb(228 228 231 / 80%);
  background: rgb(255 255 255 / 82%);
  backdrop-filter: blur(10px);
}

.md-reader-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.05rem;
  color: #18181b;
  text-decoration: none;
}

.md-reader-brand:hover {
  color: #16a34a;
}

.md-reader-eyebrow {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #a1a1aa;
}

.md-reader-main {
  flex: 1;
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

@media (min-width: 640px) {
  .md-reader-main {
    padding: 2rem 1.5rem 4rem;
  }
}
</style>
