<script setup lang="ts">
import type { PresetDemo } from '../types/preset';

const props = defineProps<{ preset: PresetDemo; view: string }>();
const themeStyle = computed(() => ({
    '--demo-bg': props.preset.theme.background,
    '--demo-fg': props.preset.theme.foreground,
    '--demo-accent': props.preset.theme.accent,
    '--demo-muted': props.preset.theme.muted,
    '--demo-font': props.preset.theme.font,
}));
const routeFor = (view: string) => ({ path: `/presets/${props.preset.id}`, query: { view } });
</script>

<template>
    <div class="preset-demo" :class="`preset-demo--${preset.id}`" :style="themeStyle">
        <header class="preset-demo__header">
            <NuxtLink class="preset-demo__brand" :to="routeFor('home')">{{ preset.demo.brand }}</NuxtLink>
            <nav aria-label="Store preview">
                <NuxtLink :to="routeFor('home')">Home</NuxtLink>
                <NuxtLink :to="routeFor('collection')">Collections</NuxtLink>
                <NuxtLink :to="routeFor('page')">Our story</NuxtLink>
            </nav>
            <span class="preset-demo__header-end" aria-hidden="true">○</span>
        </header>

        <main v-if="view === 'home'">
            <section class="preset-demo__hero" :style="{ backgroundImage: `url(${preset.demo.hero.image})` }">
                <div class="preset-demo__hero-content">
                    <p>NEW SEASON</p>
                    <h1>{{ preset.demo.hero.title }}</h1>
                    <span>{{ preset.demo.hero.subtitle }}</span>
                    <NuxtLink :to="routeFor('collection')">Explore the collection <span aria-hidden="true">→</span></NuxtLink>
                </div>
            </section>
            <section class="preset-demo__feature">
                <div>
                    <p>CURATED FOR YOU</p>
                    <h2>{{ preset.demo.collection.title }}</h2>
                    <span>{{ preset.demo.collection.description }}</span>
                    <NuxtLink :to="routeFor('collection')">View collection →</NuxtLink>
                </div>
                <img :src="preset.demo.collection.image" :alt="preset.demo.collection.title" />
            </section>
        </main>

        <main v-else-if="view === 'collection'" class="preset-demo__content">
            <p class="preset-demo__crumb">Home / Collections</p>
            <div class="preset-demo__collection-heading">
                <div>
                    <p>THE COLLECTION</p>
                    <h1>{{ preset.demo.collection.title }}</h1>
                    <span>{{ preset.demo.collection.description }}</span>
                </div>
                <span>01 item</span>
            </div>
            <div class="preset-demo__collection-grid">
                <NuxtLink :to="routeFor('product')" class="preset-demo__product-tile">
                    <img :src="preset.demo.product.image" :alt="preset.demo.product.title" />
                    <strong>{{ preset.demo.product.title }}</strong>
                    <span>{{ preset.demo.product.price }}</span>
                </NuxtLink>
                <div class="preset-demo__collection-image">
                    <img :src="preset.demo.collection.image" :alt="preset.demo.collection.title" />
                </div>
            </div>
        </main>

        <main v-else-if="view === 'product'" class="preset-demo__content">
            <p class="preset-demo__crumb">Home / Collections / {{ preset.demo.product.title }}</p>
            <div class="preset-demo__product-layout">
                <div class="preset-demo__product-image"><img :src="preset.demo.product.image" :alt="preset.demo.product.title" /></div>
                <div class="preset-demo__product-detail">
                    <p>BEST SELLER</p>
                    <h1>{{ preset.demo.product.title }}</h1>
                    <strong>{{ preset.demo.product.price }}</strong>
                    <p>{{ preset.demo.product.description }}</p>
                    <button type="button" disabled>Add to bag</button>
                    <small>Store preview · Checkout is not connected</small>
                </div>
            </div>
        </main>

        <main v-else class="preset-demo__content">
            <p class="preset-demo__crumb">Home / {{ preset.demo.page.title }}</p>
            <div class="preset-demo__story">
                <div>
                    <p>OUR STORY</p>
                    <h1>{{ preset.demo.page.title }}</h1>
                    <span>{{ preset.demo.page.body }}</span>
                </div>
                <img :src="preset.demo.page.image" :alt="preset.demo.page.title" />
            </div>
        </main>

        <footer class="preset-demo__footer">
            <strong>{{ preset.demo.brand }}</strong>
            <span>Explore · About · Contact</span>
            <small>© {{ preset.demo.brand }}</small>
        </footer>
    </div>
</template>
