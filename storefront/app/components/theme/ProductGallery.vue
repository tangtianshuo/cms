<script setup lang="ts">
import type { ProductPage } from '../../types/product';

const props = defineProps<{ product: ProductPage['product'] }>();
const activeIndex = ref(0);
const activeImage = computed(() => props.product.images[activeIndex.value]);
</script>

<template>
    <div class="product-gallery">
        <div class="product-gallery__main">
            <img v-if="activeImage" :src="activeImage.src" :alt="activeImage.alt" />
            <div v-else class="product-gallery__empty">{{ product.name }}</div>
        </div>
        <div v-if="product.images.length > 1" class="product-gallery__thumbs" aria-label="Product images">
            <button
                v-for="(image, index) in product.images"
                :key="image.src"
                type="button"
                :aria-label="`View image ${index + 1}`"
                :aria-pressed="activeIndex === index"
                :class="{ 'is-active': activeIndex === index }"
                @click="activeIndex = index"
            >
                <img :src="image.src" :alt="image.alt" />
            </button>
        </div>
    </div>
</template>
