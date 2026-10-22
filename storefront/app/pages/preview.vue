<script setup lang="ts">
import type { ProductPage } from '../types/product';

const config = useRuntimeConfig();
const page = shallowRef<ProductPage | null>(null);
useHead({
    title: 'Product preview',
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});

function onPreviewMessage(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== new URL(config.public.adminOrigin).origin) {
        return;
    }
    const message = event.data;
    if (message?.type !== 'storefront:preview' || message.payload?.config?.pageType !== 'product-detail') {
        return;
    }
    page.value = message.payload as ProductPage;
}

onMounted(() => window.addEventListener('message', onPreviewMessage));
onBeforeUnmount(() => window.removeEventListener('message', onPreviewMessage));
</script>

<template>
    <ThemeProductPage v-if="page" :page="page" />
    <div v-else class="preview-waiting">Waiting for product preview</div>
</template>
