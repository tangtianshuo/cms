<script setup lang="ts">
import { computed } from 'vue';
export interface NavigationItem {
    id?: string;
    label: string;
    href?: string;
    path?: string;
    children?: NavigationItem[];
    enabled?: boolean;
}

const props = withDefaults(defineProps<{
    nodes?: NavigationItem[];
    mobile?: boolean;
    onNavigate?: () => void;
}>(), { nodes: () => [], mobile: false });

const normalized = computed(() => (props.nodes || []).filter(item => item.enabled !== false).map((item, index) => ({
    ...item,
    id: item.id || `navigation-${index}`,
    href: item.href || item.path,
    children: (item.children || []).filter(child => child.enabled !== false),
})));
</script>

<template>
    <ul class="storefront-navigation" :class="{ 'storefront-navigation--mobile': mobile }">
        <li v-for="node in normalized" :key="node.id" class="storefront-navigation__item" :class="{ 'storefront-navigation__item--group': node.children?.length }">
            <details v-if="node.children?.length" class="storefront-navigation__accordion">
                <summary>{{ node.label }}</summary>
                <div v-if="!mobile" class="storefront-navigation__dropdown">
                    <a v-if="node.href" :href="node.href" @click="onNavigate">{{ node.label }}</a>
                    <NavigationMenu :nodes="node.children" :on-navigate="onNavigate" />
                </div>
                <NavigationMenu v-else :nodes="node.children" :mobile="true" :on-navigate="onNavigate" />
            </details>
            <a v-else-if="node.href" :href="node.href" @click="onNavigate">{{ node.label }}</a>
            <span v-else>{{ node.label }}</span>
        </li>
    </ul>
</template>
