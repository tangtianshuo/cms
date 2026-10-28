<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  bag: 'M5 7h14l1 14H4L5 7z M9 8V6a3 3 0 0 1 6 0v2',
  page: 'M14 3H5v18h14V8l-5-5z M14 3v6h5 M8 13h8 M8 17h5',
  image: 'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M16 8h.01',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  chevron: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  check: 'M5 12l4 4L19 6',
  external: 'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 1 1 4 3v2 M12 17h.01',
  sparkle: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  close: 'M6 6l12 12 M6 18L18 6',
  back: 'M19 12H5 M10 7l-5 5 5 5',
  desktop: 'M3 4h18v13H3z M12 17v4 M8 21h8',
  mobile: 'M7 2h10v20H7z M11 18h2',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  alert: 'M12 3L2 21h20L12 3z M12 9v5 M12 17h.01',
  history: 'M3 10a9 9 0 1 1 0 5 M3 4v6h6 M12 7v5l4 2',
  layers: 'M12 3L2 8l10 5 10-5-10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
  edit: 'M15 4l5 5 M4 20l5-1L21 7l-5-5L4 14v6z',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  reset: 'M3 10a9 9 0 1 1 0 5 M3 4v6h6',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.page" /></svg></template>
