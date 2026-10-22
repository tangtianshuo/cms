<script setup lang="ts">
import type { ProductPage } from '../../types/product';
import { productSeo } from '../../../utils/seo.mjs';

const route = useRoute();
const slug = String(route.params.slug || '');
const { data, error } = await useFetch<ProductPage>(`/api/products/${encodeURIComponent(slug)}`);
if (error.value || !data.value) {
    throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: 'Product not found' });
}
const seo = productSeo(data.value, useRequestURL().origin);
useHead({
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
    <ThemeProductPage v-if="data" :page="data" />
</template>
