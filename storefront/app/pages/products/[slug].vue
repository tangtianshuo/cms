<script setup lang="ts">
import type { ProductPage } from '../../types/product';
import type { PublishedPageResponse } from '../../types/preset';
import { productSeo } from '../../../utils/seo.mjs';

const route = useRoute();
definePageMeta({ key: (route) => route.path });
const { data: published, error: releaseError } = await useFetch<PublishedPageResponse>('/api/published', {
    query: { path: route.path },
});
if (releaseError.value && releaseError.value.statusCode !== 404) {
    throw createError({ statusCode: releaseError.value.statusCode || 502, statusMessage: 'Published site unavailable' });
}
if (published.value?.redirect) await navigateTo(published.value.redirect, { redirectCode: 301 });
if (import.meta.server) useResponseHeader('Cache-Control').value = 'no-store';
const slug = String(route.params.slug || '');
const { data, error } = await useFetch<ProductPage>(`/api/products/${encodeURIComponent(slug)}`, {
    immediate: !published.value,
});
if (!published.value && (error.value || !data.value)) {
    throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: 'Product not found' });
}
const seo = data.value ? productSeo(data.value, useRequestURL().origin) : null;
if (seo) useHead({
    title: seo.title,
    meta: [
        { name: 'description', content: seo.description },
        { property: 'og:title', content: seo.title },
        { property: 'og:type', content: 'product' },
    ],
    link: [{ rel: 'canonical', href: seo.canonical }],
    script: [{ type: 'application/ld+json', innerHTML: seo.structuredData }],
});
</script>

<template>
    <PublishedPage v-if="published" :page="published" />
    <ThemeProductPage v-else-if="data" :page="data" />
</template>
