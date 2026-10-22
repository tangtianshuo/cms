<script setup lang="ts">
import type { ProductPage } from '../../types/product';

const props = defineProps<{
    page: ProductPage;
    fields: Array<'name' | 'price' | 'description'>;
}>();
const price = computed(() => new Intl.NumberFormat(props.page.site.language, {
    style: 'currency',
    currency: props.page.site.currency,
}).format(props.page.product.price));
</script>

<template>
    <div class="product-information">
        <div class="product-information__eyebrow">{{ page.site.name }}</div>
        <h1 v-if="fields.includes('name')">{{ page.product.name }}</h1>
        <p v-if="fields.includes('price')" class="product-information__price">{{ price }}</p>
        <p v-if="fields.includes('description') && page.product.description" class="product-information__summary">
            {{ page.product.description }}
        </p>
        <div class="product-information__rule" />
        <div class="product-information__meta">Product details</div>
    </div>
</template>
