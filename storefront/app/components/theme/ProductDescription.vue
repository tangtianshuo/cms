<script setup lang="ts">
import type { ProductPage } from '../../types/product';

defineProps<{ product: ProductPage['product'] }>();
</script>

<template>
    <section v-if="product.description" class="product-description" aria-labelledby="product-description-title">
        <div class="product-description__inner">
            <h2 id="product-description-title">Details</h2>
            <p>{{ product.description }}</p>
        </div>
    </section>
</template>
