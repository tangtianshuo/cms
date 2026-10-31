<script setup lang="ts">
defineProps<{ items: Array<{ title?: string; text?: string; description?: string }> }>();
</script>
<template><section class="section-info-grid"><article v-for="item in items" :key="item.title"><h3>{{ item.title }}</h3><p>{{ item.text || item.description }}</p></article></section></template>
