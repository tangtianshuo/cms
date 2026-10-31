<script setup lang="ts">
import type { PresetDemo } from '../../types/preset';
import FaqSection from './FaqSection.vue';
defineProps<{ product: PresetDemo['demo']['product']; sections: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }> }>();
const list = (data: Record<string, unknown>, key: string) => Array.isArray(data[key]) ? data[key] as any[] : [];
</script>
<template>
    <div class="configured-product-sections">
        <template v-for="section in sections" :key="section.type">
            <template v-if="section.enabled">
                <section v-if="section.type === 'product-gallery'" class="configured-product-gallery" aria-label="商品图片"><img v-for="(image, index) in list(section.data, 'images')" :key="image" :src="image" :alt="`${product.title} ${index + 1}`" loading="lazy" /></section>
                <section v-else-if="section.type === 'product-information'" class="configured-product-information"><h1>{{ product.title }}</h1><strong>{{ product.price }}</strong><dl v-if="list(section.data, 'specifications').length"><div v-for="(spec, index) in list(section.data, 'specifications')" :key="index"><dt>{{ spec.label }}</dt><dd>{{ spec.value }}</dd></div></dl></section>
                <section v-else-if="section.type === 'product-description'" class="configured-product-description"><h2>商品详情</h2><p>{{ section.data.body || product.description }}</p></section>
                <FaqSection v-else-if="section.type === 'faq'" :items="list(section.data, 'items')" />
            </template>
        </template>
    </div>
</template>
