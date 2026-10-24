import {
    defineComponent,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
    type PropType,
} from 'vue';
import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import { useI18n } from 'vue-i18n';
import { createPreviewGate, sendPreview } from './preview-state';

export const ProductPreview = defineComponent({
    props: {
        entry: { type: Object as PropType<Entry>, required: true },
    },
    setup(props) {
        const { t } = useI18n();
        const origin = new URL(import.meta.env.VITE_STOREFRONT_ORIGIN || 'http://localhost:3000').origin;
        const frame = ref<HTMLIFrameElement>();
        const frameReady = ref(false);
        const loading = ref(false);
        const error = ref('');
        const page = ref<unknown>();
        const gate = createPreviewGate();
        const refreshTick = ref(0);
        function refreshCapabilities() {
            if (document.visibilityState === 'visible') refreshTick.value++;
        }
        const capabilityRefresh = setInterval(refreshCapabilities, 5 * 60000);
        onMounted(() => document.addEventListener('visibilitychange', refreshCapabilities));
        let timeout: ReturnType<typeof setTimeout> | undefined;

        function deliver() {
            if (frameReady.value && frame.value && page.value) {
                sendPreview(frame.value, origin, page.value);
            }
        }

        watch(
            [() => props.entry, refreshTick],
            () => {
                const sequence = gate.next();
                if (timeout) {
                    clearTimeout(timeout);
                }
                timeout = setTimeout(async () => {
                    loading.value = true;
                    try {
                        const result = await window.bcms.sdk.send<unknown>({
                            url: '/api/v4/storefront/preview',
                            method: 'POST',
                            data: { entry: props.entry },
                        });
                        if (gate.isCurrent(sequence)) {
                            page.value = result;
                            error.value = '';
                            deliver();
                        }
                    } catch (cause) {
                        if (gate.isCurrent(sequence)) {
                            page.value = undefined;
                            error.value = (cause as Error).message || t('storefrontPreview.error');
                        }
                    } finally {
                        if (gate.isCurrent(sequence)) {
                            loading.value = false;
                        }
                    }
                }, 350);
            },
            { deep: true, immediate: true },
        );

        onBeforeUnmount(() => {
            clearInterval(capabilityRefresh);
            document.removeEventListener('visibilitychange', refreshCapabilities);
            gate.next();
            if (timeout) {
                clearTimeout(timeout);
            }
        });

        return () => (
            <aside class="min-w-0 border border-gray/50 dark:border-gray bg-light/50 dark:bg-darkGray/50 rounded-xl overflow-hidden">
                <div class="flex items-center justify-between gap-3 border-b border-gray/50 dark:border-gray px-4 py-3">
                    <strong class="text-sm">{t('storefrontPreview.title')}</strong>
                    <span class="text-xs opacity-70" aria-live="polite">
                        {loading.value ? t('storefrontPreview.updating') : error.value ? t('storefrontPreview.failed') : t('storefrontPreview.draft')}
                    </span>
                </div>
                {error.value && <p class="px-4 py-3 text-sm text-red" role="alert">{error.value}</p>}
                <iframe
                    ref={frame}
                    title={t('storefrontPreview.title')}
                    src={`${origin}/preview`}
                    class="w-full h-[650px] border-0 bg-white"
                    onLoad={() => {
                        frameReady.value = true;
                        deliver();
                    }}
                />
            </aside>
        );
    },
});
