<script setup lang="ts">
import type { ProductPage as Page } from '../../types/product';
import ProductGallery from './ProductGallery.vue';
import ProductInformation from './ProductInformation.vue';
import ProductDescription from './ProductDescription.vue';

defineProps<{ page: Page }>();

const sections = {
    'product-gallery': ProductGallery,
    'product-information': ProductInformation,
    'product-description': ProductDescription,
};
</script>

<template>
    <div class="storefront">
        <header class="storefront-header">
            <div class="storefront-header__inner">
                <span class="storefront-brand">{{ page.site.name }}</span>
                <span class="storefront-header__label">Product</span>
            </div>
        </header>
        <main>
            <div class="product-layout">
                <template v-for="section in page.config.sections" :key="section.type">
                    <component
                        :is="sections[section.type]"
                        v-if="section.type !== 'product-description'"
                        :product="page.product"
                        :page="page"
                        :fields="section.type === 'product-information' ? section.fields : undefined"
                    />
                </template>
            </div>
            <template v-for="section in page.config.sections" :key="section.type">
                <ProductDescription v-if="section.type === 'product-description'" :product="page.product" />
            </template>
        </main>
        <footer class="storefront-footer">{{ page.site.name }}</footer>
    </div>
</template>
