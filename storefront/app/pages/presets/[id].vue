<script setup lang="ts">
import type { PresetDemo } from '../../types/preset';

const route = useRoute();
const id = String(route.params.id || '');
const validViews = ['home', 'collection', 'product', 'page'];
const view = computed(() => {
    const raw = route.query.view;
    if (raw === undefined) return 'home';
    return typeof raw === 'string' && validViews.includes(raw) ? raw : null;
});
if (!view.value) throw createError({ statusCode: 404, statusMessage: 'Preview page not found' });
const { data, error } = await useFetch<PresetDemo>(`/api/presets/${encodeURIComponent(id)}`);
if (error.value || !data.value) {
    throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: 'Preset not found' });
}
useHead({
    title: `${data.value.name} preview`,
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});
</script>

<template>
    <PresetDemoPage v-if="data && view" :preset="data" :view="view" />
</template>
