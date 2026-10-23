<script setup lang="ts">
import type { PublishedPageResponse } from '../types/preset';

const props = defineProps<{ page: PublishedPageResponse }>();
const origin = useRequestURL().origin;
useHead(() => ({
    htmlAttrs: { lang: props.page.language },
    title: props.page.content?.seo.title,
    meta: [
        { name: 'description', content: props.page.content?.seo.description || '' },
        { property: 'og:title', content: props.page.content?.seo.title || '' },
    ],
    link: [{ rel: 'canonical', href: new URL(props.page.path, origin).href }],
}));
</script>

<template>
    <PresetDemoPage v-if="page.content" :preset="page.content.preset" :view="page.content.view"
        :sections="page.content.sections" :items="page.content.items" :navigation="page.navigation" mode="published" />
</template>
