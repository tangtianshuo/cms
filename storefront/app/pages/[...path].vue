<script setup lang="ts">
import type { PublishedPageResponse } from '../types/preset';

definePageMeta({ key: (route) => route.path });
const route = useRoute();
const { data, error } = await useFetch<PublishedPageResponse>('/api/published', { query: { path: route.path } });
if (error.value || !data.value) {
    throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: 'Page not found' });
}
if (data.value.redirect) await navigateTo(data.value.redirect, { redirectCode: 301 });
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store';
</script>

<template>
    <PublishedPage v-if="data" :page="data" />
</template>
