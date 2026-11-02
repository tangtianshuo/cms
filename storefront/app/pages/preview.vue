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
    if (message?.type === 'studio:select-node') {
        if (typeof message.pageKey !== 'string' || typeof message.nodeId !== 'string' || typeof message.nodeType !== 'string') return;
        const node = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-node-id]')).find(item => item.dataset.studioNodeId === message.nodeId && item.dataset.studioNodeType === message.nodeType);
        if (!node) return;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.dataset.studioSelected = 'true';
        window.setTimeout(() => { delete node.dataset.studioSelected; }, 1200);
        window.parent.postMessage({ type: 'studio:node-selected', pageKey: message.pageKey, nodeId: message.nodeId, nodeType: message.nodeType,
            templateId: presetPage.value?.preset.id || siteDraft.value?.pages[0]?.content.preset.id,
            templateVersion: presetPage.value?.preset.version || siteDraft.value?.pages[0]?.content.preset.version }, event.origin);
        return;
    }
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

onMounted(() => {
    window.addEventListener('message', onPreviewMessage);
    window.parent.postMessage({ type: 'storefront:preview-ready' }, new URL(config.public.adminOrigin).origin);
});
onBeforeUnmount(() => window.removeEventListener('message', onPreviewMessage));
</script>

<template>
    <DraftSitePreview v-if="siteDraft" :site="siteDraft" />
    <PresetDemoPage v-else-if="presetPage" :preset="presetPage.preset" :view="presetPage.view"
        :sections="presetPage.sections" :section-configs="presetPage.sectionConfigs" :layout-document="presetPage.layoutDocument" mode="draft" />
    <ThemeProductPage v-else-if="productPage" :page="productPage" />
    <div v-else class="preview-waiting">Waiting for page preview</div>
</template>
