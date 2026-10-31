<script setup lang="ts">
import type { ProductPage } from '../../types/product';

const props = defineProps<{
    page: ProductPage;
    fields?: Array<'name' | 'price' | 'description'>;
    specifications?: Array<{ label: string; value: string }>;
    relatedProducts?: string[];
    cta?: { label: string; href: string };
}>();
const price = computed(() => new Intl.NumberFormat(props.page.site.language, {
    style: 'currency',
    currency: props.page.site.currency,
}).format(props.page.product.price));
</script>

<template>
    <div class="product-information">
        <div class="product-information__eyebrow">{{ page.site.name }}</div>
        <h1 v-if="fields?.includes('name')">{{ page.product.name }}</h1>
        <p v-if="fields?.includes('price')" class="product-information__price">{{ price }}</p>
        <p v-if="fields?.includes('description') && page.product.description" class="product-information__summary">
            {{ page.product.description }}
        </p>
        <div class="product-information__rule" />
        <div class="product-information__meta">Product details</div>
        <dl v-if="specifications?.length" class="product-information__specifications"><template v-for="item in specifications" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></template></dl>
        <a v-if="cta" class="product-information__cta" :href="cta.href">{{ cta.label }}</a>
        <div v-if="relatedProducts?.length" class="product-information__related"><h2>相关商品</h2><ul><li v-for="slug in relatedProducts" :key="slug"><a :href="`/products/${slug}`">{{ slug }}</a></li></ul></div>
    </div>
</template>
