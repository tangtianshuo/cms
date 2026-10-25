<script setup lang="ts">
import type { SiteDraftPreview } from '../types/preset';

const props = defineProps<{ site: SiteDraftPreview }>();
const currentPath = ref('/');
const missing = ref(false);
const currentPage = computed(() => props.site.pages.find((page) => page.path === currentPath.value));

function navigate(path: string) {
    if (path === currentPath.value) return;
    if (props.site.pages.some((page) => page.path === path)) {
        currentPath.value = path;
        missing.value = false;
        return;
    }
    const redirect = props.site.redirects.find((item) => item.from === path);
    if (redirect && props.site.pages.some((page) => page.path === redirect.to)) {
        currentPath.value = redirect.to;
        missing.value = false;
        return;
    }
    currentPath.value = path;
    missing.value = true;
}

function onLinkClick(event: MouseEvent) {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href) || href.startsWith('//')) return;
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/')) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(url.pathname);
}

useHead({
    title: computed(() => currentPage.value
        ? `${currentPage.value.content.seo.title} · Draft preview`
        : `Draft preview · ${props.site.siteName}`),
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});
</script>

<template>
    <div class="site-draft-preview" @click.capture="onLinkClick">
        <PresetDemoPage v-if="currentPage" :preset="currentPage.content.preset"
            :view="currentPage.content.view" :sections="currentPage.content.sections"
            :items="currentPage.content.items" :navigation="site.navigation" mode="published" />
        <div v-else-if="missing" class="draft-site-404">
            <p>{{ site.siteName }}</p>
            <h1>Page not in draft preview</h1>
            <p><code>{{ currentPath }}</code> is not part of the current draft site.</p>
            <button type="button" @click="navigate('/')">Return to home</button>
        </div>
        <div v-else class="draft-site-waiting">Loading draft site…</div>
    </div>
</template>
