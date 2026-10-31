<script setup lang="ts">
interface Slide { image?: string; title?: string; subtitle?: string; order?: number; cta?: { label?: string; href?: string } }
const props = withDefaults(defineProps<{ slides: Slide[]; autoplay?: boolean }>(), { autoplay: true });
const active = ref(0); const paused = ref(false); let timer: ReturnType<typeof setInterval> | undefined;
const ordered = computed(() => [...props.slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
const next = () => { active.value = (active.value + 1) % Math.max(ordered.value.length, 1); };
const prev = () => { active.value = (active.value - 1 + ordered.value.length) % Math.max(ordered.value.length, 1); };
onMounted(() => { if (props.autoplay) timer = setInterval(() => { if (!paused.value) next(); }, 5000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>
<template>
  <section class="section-hero-carousel" tabindex="0" @keydown.left.prevent="prev" @keydown.right.prevent="next" @mouseenter="paused = true" @mouseleave="paused = false">
    <div v-for="(slide, index) in ordered" v-show="index === active" :key="`${slide.order ?? index}-${slide.title ?? ''}`" class="section-hero-carousel__slide">
      <img v-if="slide.image" :src="slide.image" :alt="slide.title || ''" />
      <div class="section-hero-carousel__content"><h2>{{ slide.title }}</h2><p v-if="slide.subtitle">{{ slide.subtitle }}</p><a v-if="slide.cta?.href" :href="slide.cta.href">{{ slide.cta.label || '了解更多' }}</a></div>
    </div>
    <div v-if="ordered.length > 1" class="section-hero-carousel__controls"><button type="button" aria-label="上一张" @click="prev">‹</button><button v-for="(_, index) in ordered" :key="index" type="button" :aria-label="`第 ${index + 1} 张`" :aria-current="index === active" @click="active = index">●</button><button type="button" aria-label="下一张" @click="next">›</button></div>
  </section>
</template>
