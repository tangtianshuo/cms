<script setup lang="ts">
defineProps<{ items: Array<{ question: string; answer: string }> }>();
</script>
<template><section class="section-faq" aria-label="常见问题"><details v-for="item in items" :key="item.question"><summary>{{ item.question }}</summary><p>{{ item.answer }}</p></details></section></template>
