<script setup lang="ts">
import type { PublishedPageResponse } from '../types/preset';
import { publicRuntimeHeaders } from '../utils/public-runtime.mjs';

definePageMeta({ key: (route) => route.path });
const route = useRoute();
const requestFetch = useRequestFetch();
const requestHeaders = import.meta.server
    ? publicRuntimeHeaders(useRequestHeaders(['host', 'x-storefront-host', 'x-storefront-key']))
    : undefined;
const { data, error } = await useAsyncData(`published:${route.path}`, () => requestFetch<PublishedPageResponse>('/api/published', {
    query: { path: route.path },
    ...(requestHeaders ? { headers: requestHeaders } : {}),
}));
if (error.value || !data.value) {
    throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: 'Page not found' });
}
if (data.value.redirect) await navigateTo(data.value.redirect, { redirectCode: 301 });
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store';
</script>

<template>
    <PublishedPage v-if="data" :page="data" />
</template>
