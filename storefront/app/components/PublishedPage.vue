<script setup lang="ts">
import type { PublishedPageResponse } from '../types/preset';

const props = defineProps<{ page: PublishedPageResponse }>();
useHead(() => ({
    htmlAttrs: { lang: props.page.language },
    title: props.page.content?.seo.title,
    meta: [
        { name: 'description', content: props.page.content?.seo.description || '' },
        { property: 'og:title', content: props.page.content?.seo.title || '' },
        ...(props.page.content?.operations?.socialImageUrl ? [{ property: 'og:image', content: props.page.content.operations.socialImageUrl }] : []),
    ],
    link: [{ rel: 'canonical' as const, href: new URL(props.page.path, props.page.origin).href }, ...(props.page.content?.operations?.faviconUrl ? [{ rel: 'icon' as const, href: props.page.content.operations.faviconUrl }] : [])],
    script: props.page.content?.operations?.analyticsId ? [{ async: true, src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(props.page.content.operations.analyticsId)}` }] : [],
}));
</script>

<template>
    <PresetDemoPage v-if="page.content" :preset="page.content.preset" :view="page.content.view"
        :sections="page.content.sections" :section-configs="page.content.sectionConfigs" :items="page.content.items" :navigation="page.navigation" mode="published" />
</template>
