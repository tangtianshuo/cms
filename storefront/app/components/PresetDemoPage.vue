<script setup lang="ts">
import type { PresetDemo, PresetPagePreview } from '../types/preset';
import NavigationMenu, { type NavigationItem } from './NavigationMenu.vue';
import HeroCarousel from './sections/HeroCarousel.vue';
import InfoGrid from './sections/InfoGrid.vue';
import FaqSection from './sections/FaqSection.vue';
import ProductSections from './sections/ProductSections.vue';

const props = withDefaults(defineProps<{ preset: PresetDemo; view: string; sections?: string[];
    mode?: 'demo' | 'draft' | 'published'; navigation?: NavigationItem[];
    items?: PresetPagePreview['items']; sectionConfigs?: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }> }>(), {
    mode: 'demo',
});
const themeStyle = computed(() => ({
    '--demo-bg': props.preset.theme.background,
    '--demo-fg': props.preset.theme.foreground,
    '--demo-accent': props.preset.theme.accent,
    '--demo-muted': props.preset.theme.muted,
    '--demo-font': props.preset.theme.font,
}));
const routeFor = (view: string) => ({ path: `/presets/${props.preset.id}`, query: { view } });
const show = (section: string) => !props.sections || props.sections.includes(section);
const configured = computed(() => props.sectionConfigs || []);
const sectionItems = (section: { data: Record<string, unknown> }, key: string) => Array.isArray(section.data[key]) ? section.data[key] as any[] : [];
const menuOpen = ref(false);
const navigationNodes = computed(() => props.mode === 'published' ? (props.navigation || []) : [
    { label: 'Home', href: routeFor('home').path }, { label: 'Collections', href: routeFor('collection').path }, { label: 'Our story', href: routeFor('page').path },
]);
</script>

<template>
    <AeroPresetPage v-if="preset.id === 'aeroframe'" :preset="preset" :view="view" :mode="mode" :navigation="navigation" :items="items" :sections="sections" :section-configs="sectionConfigs" />
    <div v-else class="preset-demo" :class="[`preset-demo--${preset.id}`, { 'preset-demo--draft': mode === 'draft' }]" :style="themeStyle">
        <header class="preset-demo__header">
            <span v-if="mode === 'draft'" class="preset-demo__brand">{{ preset.demo.brand }}</span>
            <NuxtLink v-else class="preset-demo__brand" :to="mode === 'published' ? '/' : routeFor('home')">{{ preset.demo.brand }}</NuxtLink>
            <nav aria-label="Store preview" :inert="mode === 'draft'"><NavigationMenu :nodes="navigationNodes" /></nav>
            <button class="preset-demo__menu" type="button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">{{ menuOpen ? '关闭' : '菜单' }}</button>
            <div v-if="menuOpen" class="preset-demo__mobile-nav"><NavigationMenu :nodes="navigationNodes" mobile :on-navigate="() => { menuOpen = false; }" /></div>
            <span class="preset-demo__header-end" aria-hidden="true">○</span>
        </header>

        <main v-if="view === 'home'">
            <template v-if="configured.length">
                <template v-for="section in configured" :key="section.type">
                    <HeroCarousel v-if="section.enabled && section.type === 'hero-carousel'" :slides="sectionItems(section, 'slides')" />
                    <InfoGrid v-else-if="section.enabled && section.type === 'info-grid'" :items="sectionItems(section, 'items')" />
                    <FaqSection v-else-if="section.enabled && section.type === 'faq'" :items="sectionItems(section, 'items')" />
                </template>
            </template>
            <template v-else>
            <section v-if="show('hero')" class="preset-demo__hero" :class="{ 'preset-demo__hero--empty': !preset.demo.hero.image }"
                :style="preset.demo.hero.image ? { backgroundImage: `url(${preset.demo.hero.image})` } : undefined">
                <div class="preset-demo__hero-content">
                    <p>NEW SEASON</p>
                    <h1>{{ preset.demo.hero.title }}</h1>
                    <span>{{ preset.demo.hero.subtitle }}</span>
                    <NuxtLink v-if="mode === 'demo'" :to="routeFor('collection')">Explore the collection <span aria-hidden="true">→</span></NuxtLink>
                </div>
            </section>
            <div v-if="mode === 'published' && items?.length" class="preset-demo__collection-grid preset-demo__content">
                <NuxtLink v-for="item in items" :key="item.path" :to="item.path" class="preset-demo__product-tile">
                    <img v-if="item.image" :src="item.image" :alt="item.label" />
                    <strong>{{ item.label }}</strong><span>{{ item.price }}</span>
                </NuxtLink>
            </div>
            <section v-if="show('feature') && (mode === 'demo' || preset.demo.collection.title)" class="preset-demo__feature">
                <div>
                    <p>CURATED FOR YOU</p>
                    <h2>{{ preset.demo.collection.title }}</h2>
                    <span>{{ preset.demo.collection.description }}</span>
                    <NuxtLink v-if="mode === 'demo'" :to="routeFor('collection')">View collection →</NuxtLink>
                </div>
                <img v-if="preset.demo.collection.image" :src="preset.demo.collection.image" :alt="preset.demo.collection.title" />
            </section>
            </template>
        </main>

        <main v-else-if="view === 'collection'" class="preset-demo__content">
            <p class="preset-demo__crumb">Home / Collections</p>
            <div v-if="show('heading')" class="preset-demo__collection-heading">
                <div>
                    <p>THE COLLECTION</p>
                    <h1>{{ preset.demo.collection.title }}</h1>
                    <span>{{ preset.demo.collection.description }}</span>
                </div>
                <span v-if="mode !== 'published'">01 item</span>
                <span v-else>{{ items?.length || 0 }} items</span>
            </div>
            <div v-if="show('grid')" class="preset-demo__collection-grid">
                <NuxtLink v-if="mode !== 'published' && (mode === 'demo' || preset.demo.product.title)" :to="routeFor('product')" class="preset-demo__product-tile" :inert="mode === 'draft'">
                    <img v-if="preset.demo.product.image" :src="preset.demo.product.image" :alt="preset.demo.product.title" />
                    <strong>{{ preset.demo.product.title }}</strong>
                    <span>{{ preset.demo.product.price }}</span>
                </NuxtLink>
                <NuxtLink v-for="item in mode === 'published' ? items : []" :key="item.path" :to="item.path" class="preset-demo__product-tile">
                    <img v-if="item.image" :src="item.image" :alt="item.label" />
                    <strong>{{ item.label }}</strong><span>{{ item.price }}</span>
                </NuxtLink>
                <div v-if="preset.demo.collection.image" class="preset-demo__collection-image">
                    <img :src="preset.demo.collection.image" :alt="preset.demo.collection.title" />
                </div>
            </div>
        </main>

        <main v-else-if="view === 'product'" class="preset-demo__content">
            <ProductSections v-if="configured.length" :product="preset.demo.product" :sections="configured" />
            <template v-else>
            <p class="preset-demo__crumb">Home / Collections / {{ preset.demo.product.title }}</p>
            <div class="preset-demo__product-layout">
                <div v-if="show('gallery')" class="preset-demo__product-image"><img v-if="preset.demo.product.image" :src="preset.demo.product.image" :alt="preset.demo.product.title" /></div>
                <div class="preset-demo__product-detail">
                    <p>BEST SELLER</p>
                    <h1>{{ preset.demo.product.title }}</h1>
                    <strong v-if="show('information')">{{ preset.demo.product.price }}</strong>
                    <p v-if="show('description')">{{ preset.demo.product.description }}</p>
                    <button v-if="mode === 'demo'" type="button" disabled>Add to bag</button>
                    <small v-if="mode === 'demo'">Store preview · Checkout is not connected</small>
                </div>
            </div>
        </template>
        </main>

        <main v-else class="preset-demo__content">
            <p class="preset-demo__crumb">Home / {{ preset.demo.page.title }}</p>
            <div v-if="show('story')" class="preset-demo__story">
                <div>
                    <p>OUR STORY</p>
                    <h1>{{ preset.demo.page.title }}</h1>
                    <span>{{ preset.demo.page.body }}</span>
                </div>
                <img v-if="preset.demo.page.image" :src="preset.demo.page.image" :alt="preset.demo.page.title" />
            </div>
        </main>

        <footer class="preset-demo__footer">
            <strong>{{ preset.demo.brand }}</strong>
            <nav v-if="mode === 'published'" aria-label="Footer"><NavigationMenu :nodes="navigationNodes" /></nav>
            <span v-else>Explore · About · Contact</span>
            <small>© {{ preset.demo.brand }}</small>
        </footer>
    </div>
</template>
