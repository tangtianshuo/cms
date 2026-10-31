<script setup lang="ts">
import type { PresetDemo, PresetPagePreview } from '../types/preset';
import NavigationMenu, { type NavigationItem } from './NavigationMenu.vue';
import HeroCarousel from './sections/HeroCarousel.vue';
import InfoGrid from './sections/InfoGrid.vue';
import FaqSection from './sections/FaqSection.vue';
import ProductSections from './sections/ProductSections.vue';

const props = withDefaults(defineProps<{
    preset: PresetDemo;
    view: string;
    mode?: 'demo' | 'draft' | 'published';
    navigation?: NavigationItem[];
    items?: PresetPagePreview['items'];
    sections?: string[];
    sectionConfigs?: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }>;
}>(), { mode: 'demo' });

const menuOpen = ref(false);
const showcase = computed(() => props.preset.showcase);
const show = (section: string) => !props.sections || props.sections.includes(section);
const configured = computed(() => props.sectionConfigs || []);
const sectionItems = (section: { data: Record<string, unknown> }, key: string) => Array.isArray(section.data[key]) ? section.data[key] as any[] : [];
const routeFor = (view: string) => ({ path: `/presets/${props.preset.id}`, query: { view } });
const quoteHref = computed(() => props.preset.demo.contactEmail
    ? `mailto:${encodeURIComponent(props.preset.demo.contactEmail)}?subject=${encodeURIComponent('Project inquiry')}`
    : 'mailto:');
const navigationNodes = computed(() => props.navigation || []);
const flattenNavigation = (nodes: NavigationItem[]): NavigationItem[] => nodes.flatMap(node => [node, ...flattenNavigation(node.children || [])]);
const flatNavigation = computed(() => flattenNavigation(navigationNodes.value));
const publishedCollection = computed(() => flatNavigation.value.find((link) => (link.href || link.path) !== '/')?.href || flatNavigation.value.find((link) => (link.href || link.path) !== '/')?.path || '/collections');
const publishedCompany = computed(() => { const link = flatNavigation.value.find((item) => /about|company|story|page/i.test(item.label)); return link?.href || link?.path || '/pages/about'; });
const products = computed(() => props.mode === 'published'
    ? props.items || []
    : (showcase.value?.products || [props.preset.demo.product]).map((item) => ({
        label: item.title,
        path: routeFor('product').path,
        image: item.image,
        description: item.description,
        price: item.price,
    })));
</script>

<template>
    <div class="aero-site">
        <header class="aero-header">
            <NuxtLink class="aero-brand" :to="mode === 'published' ? '/' : routeFor('home')">
                <span class="aero-brand__mark" aria-hidden="true">A</span>
                <span>{{ preset.demo.brand }}</span>
            </NuxtLink>
            <nav aria-label="Main navigation"><NavigationMenu v-if="mode === 'published'" :nodes="navigationNodes" /><NavigationMenu v-else :nodes="[{ label: 'Overview', href: routeFor('home').path }, { label: 'Platforms', href: routeFor('collection').path }, { label: 'Company', href: routeFor('page').path }]" /></nav>
            <a class="aero-header__cta" :href="quoteHref">Request a quote <span aria-hidden="true">↗</span></a>
            <button class="aero-header__menu" type="button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
                {{ menuOpen ? 'Close' : 'Menu' }}
            </button>
            <div v-if="menuOpen" class="aero-mobile-panel"><NavigationMenu v-if="mode === 'published'" :nodes="navigationNodes" mobile :on-navigate="() => { menuOpen = false; }" /><NavigationMenu v-else mobile :nodes="[{ label: 'Overview', href: routeFor('home').path }, { label: 'Platforms', href: routeFor('collection').path }, { label: 'Company', href: routeFor('page').path }]" :on-navigate="() => { menuOpen = false; }" />
                <a :href="quoteHref">Request a quote <span aria-hidden="true">↗</span></a>
            </div>
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
            <section v-if="show('hero')" class="aero-hero" :style="{ '--aero-hero-image': `url('${preset.demo.hero.image}')` }">
                <div class="aero-hero__content">
                    <p class="aero-kicker">{{ showcase?.heroLabel || 'UNMANNED SYSTEMS / FIELD PROVEN' }}</p>
                    <h1>{{ preset.demo.hero.title }}</h1>
                    <p class="aero-hero__intro">{{ preset.demo.hero.subtitle }}</p>
                    <div class="aero-hero__actions">
                        <NuxtLink class="aero-button aero-button--primary" :to="mode === 'published' ? publishedCollection : routeFor('collection')">
                            Explore platforms <span aria-hidden="true">→</span>
                        </NuxtLink>
                        <a class="aero-button aero-button--quiet" :href="quoteHref">Talk to an engineer</a>
                    </div>
                    <div class="aero-hero__foot"><span>01 / 04</span><span>Designed around the mission</span><span aria-hidden="true">↓</span></div>
                </div>
                <div class="aero-hero__image-label"><span class="aero-pulse"></span> FIELD SYSTEMS / ONLINE</div>
            </section>

            <template v-if="show('feature')">
            <section class="aero-intro aero-wrap">
                <p class="aero-kicker">{{ showcase?.eyebrow }}</p>
                <h2>{{ preset.demo.collection.title }}</h2>
                <p>{{ preset.demo.collection.description }}</p>
                <div class="aero-stat-row">
                    <div v-for="stat in showcase?.stats" :key="stat.label" class="aero-stat">
                        <strong>{{ stat.value }}</strong><span>{{ stat.label }}</span>
                    </div>
                </div>
            </section>

            <section id="platforms" class="aero-platforms aero-wrap">
                <div class="aero-section-heading">
                    <div><p class="aero-kicker">THE FLEET</p><h2>Platforms built for the field</h2></div>
                    <NuxtLink :to="mode === 'published' ? publishedCollection : routeFor('collection')">View platform range <span aria-hidden="true">↗</span></NuxtLink>
                </div>
                <div class="aero-product-grid">
                    <NuxtLink v-for="(item, index) in products" :key="item.path" class="aero-product-card" :to="mode === 'published' ? item.path : routeFor('product')">
                        <div class="aero-product-card__image"><img v-if="item.image" :src="item.image" :alt="item.label" loading="lazy" /><span class="aero-index">0{{ index + 1 }}</span><span class="aero-arrow" aria-hidden="true">↗</span></div>
                        <div class="aero-product-card__body"><div><p class="aero-kicker">{{ preset.demo.brand }} / UAV</p><h3>{{ item.label }}</h3></div><strong>{{ item.price }}</strong></div>
                        <p class="aero-product-card__description">{{ item.description }}</p>
                    </NuxtLink>
                </div>
            </section>

            <section class="aero-solutions aero-wrap">
                <div class="aero-section-heading"><div><p class="aero-kicker">MISSION PROFILES</p><h2>One system. More ways to work.</h2></div><span class="aero-muted">01 — 03 / APPLICATIONS</span></div>
                <div class="aero-solution-grid">
                    <article v-for="(solution, index) in showcase?.solutions" :key="solution.title" class="aero-solution-card">
                        <img :src="solution.image" :alt="solution.title" loading="lazy" />
                        <div><p class="aero-kicker">MISSION / 0{{ index + 1 }}</p><h3>{{ solution.title }}</h3><p>{{ solution.description }}</p><a :href="quoteHref">Discuss this mission <span aria-hidden="true">↗</span></a></div>
                    </article>
                </div>
            </section>

            <section class="aero-story">
                <div class="aero-story__image" :style="{ backgroundImage: `url('${preset.demo.page.image}')` }"></div>
                <div class="aero-story__content"><p class="aero-kicker">ENGINEERED FOR REAL OPERATIONS</p><h2>Confidence from takeoff to touchdown.</h2><p>{{ preset.demo.page.body }}</p><NuxtLink :to="mode === 'published' ? publishedCompany : routeFor('page')">Our approach <span aria-hidden="true">→</span></NuxtLink></div>
            </section>

            <section class="aero-faq aero-wrap">
                <div><p class="aero-kicker">SUPPORT &amp; OPERATIONS</p><h2>Questions from the field.</h2><p>Clear answers for teams evaluating their next aerial system.</p></div>
                <div class="aero-faq__list"><details v-for="faq in showcase?.faq" :key="faq.question"><summary>{{ faq.question }}<span aria-hidden="true">+</span></summary><p>{{ faq.answer }}</p></details></div>
            </section>

            <section id="contact" class="aero-contact aero-wrap"><div><p class="aero-kicker">START A CONVERSATION</p><h2>Tell us what the mission demands.</h2></div><a class="aero-button aero-button--primary" :href="quoteHref">Request a quote <span aria-hidden="true">↗</span></a></section>
            </template>
            </template>
        </main>

        <main v-else-if="view === 'collection'" class="aero-inner aero-wrap">
            <template v-if="show('heading')"><p class="aero-kicker">AIRCRAFT / PRODUCT RANGE</p><h1>{{ preset.demo.collection.title }}</h1><p class="aero-page-intro">{{ preset.demo.collection.description }}</p></template>
            <div v-if="show('grid')" class="aero-product-grid aero-product-grid--catalog"><NuxtLink v-for="(item, index) in products" :key="item.path" class="aero-product-card" :to="mode === 'published' ? item.path : routeFor('product')"><div class="aero-product-card__image"><img v-if="item.image" :src="item.image" :alt="item.label" loading="lazy" /><span class="aero-index">0{{ index + 1 }}</span><span class="aero-arrow" aria-hidden="true">↗</span></div><div class="aero-product-card__body"><div><p class="aero-kicker">MULTIROTOR / MODULAR</p><h3>{{ item.label }}</h3></div><strong>{{ item.price }}</strong></div><p class="aero-product-card__description">{{ item.description }}</p></NuxtLink></div>
        </main>

        <main v-else-if="view === 'product'" class="aero-product-page aero-wrap">
            <ProductSections v-if="configured.length" :product="preset.demo.product" :sections="configured" />
            <template v-else>
            <p class="aero-kicker">PLATFORM / {{ preset.demo.brand }}</p><div class="aero-product-page__grid"><div v-if="show('gallery')" class="aero-product-page__image"><img v-if="preset.demo.product.image" :src="preset.demo.product.image" :alt="preset.demo.product.title" /></div><div class="aero-product-page__info"><p class="aero-kicker">MODULAR MULTIROTOR SYSTEM</p><h1>{{ preset.demo.product.title }}</h1><strong v-if="show('information')">{{ preset.demo.product.price }}</strong><p v-if="show('description')">{{ preset.demo.product.description }}</p><ul v-if="show('information')"><li v-for="stat in showcase?.stats" :key="stat.label"><span>{{ stat.label }}</span><b>{{ stat.value }}</b></li></ul><a class="aero-button aero-button--primary" :href="quoteHref">Configure this platform <span aria-hidden="true">↗</span></a><small>Final configuration and pricing depend on payload and mission requirements.</small></div></div>
        </template>
        </main>

        <main v-else class="aero-inner aero-wrap"><p class="aero-kicker">{{ preset.demo.brand }} / COMPANY</p><div v-if="show('story')" class="aero-about"><div><h1>{{ preset.demo.page.title }}</h1><p>{{ preset.demo.page.body }}</p><a class="aero-button aero-button--primary" :href="quoteHref">Contact the team <span aria-hidden="true">↗</span></a></div><img v-if="preset.demo.page.image" :src="preset.demo.page.image" :alt="preset.demo.page.title" /></div></main>

        <footer class="aero-footer"><NuxtLink class="aero-brand" :to="mode === 'published' ? '/' : routeFor('home')"><span class="aero-brand__mark" aria-hidden="true">A</span><span>{{ preset.demo.brand }}</span></NuxtLink><span>UNMANNED SYSTEMS / FIELD PROVEN</span><small>© {{ new Date().getFullYear() }} {{ preset.demo.brand }}</small></footer>
    </div>
</template>
