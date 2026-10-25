<script setup lang="ts">
import type { ProductPage } from '../types/product';
import type { PresetPagePreview, SiteDraftPreview } from '../types/preset';
import { isPresetPreviewPayload, isSiteDraftPreviewPayload } from '../utils/preview.mjs';

const config = useRuntimeConfig();
const productPage = shallowRef<ProductPage | null>(null);
const presetPage = shallowRef<PresetPagePreview | null>(null);
const siteDraft = shallowRef<SiteDraftPreview | null>(null);
useHead({
    title: 'Page preview',
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});

function onPreviewMessage(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== new URL(config.public.adminOrigin).origin) {
        return;
    }
    const message = event.data;
    if (message?.type !== 'storefront:preview') return;
    if (isSiteDraftPreviewPayload(message.payload)) {
        siteDraft.value = message.payload as SiteDraftPreview;
        presetPage.value = null;
        productPage.value = null;
    } else if (isPresetPreviewPayload(message.payload)) {
        siteDraft.value = null;
        presetPage.value = message.payload as PresetPagePreview;
        productPage.value = null;
    } else if (message.payload?.config?.pageType === 'product-detail') {
        siteDraft.value = null;
        productPage.value = message.payload as ProductPage;
        presetPage.value = null;
    }
}

onMounted(() => window.addEventListener('message', onPreviewMessage));
onBeforeUnmount(() => window.removeEventListener('message', onPreviewMessage));
</script>

<template>
    <DraftSitePreview v-if="siteDraft" :site="siteDraft" />
    <PresetDemoPage v-else-if="presetPage" :preset="presetPage.preset" :view="presetPage.view"
        :sections="presetPage.sections" mode="draft" />
    <ThemeProductPage v-else-if="productPage" :page="productPage" />
    <div v-else class="preview-waiting">Waiting for page preview</div>
</template>
