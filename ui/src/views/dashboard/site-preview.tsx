import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { sendPreview } from '@bcms/selfhosted-ui/components/storefront/preview-state';

export const SitePreviewView = defineComponent({
    setup() {
        const { t } = useI18n();
        const route = useRoute();
        const sdk = window.bcms.sdk;
        const frame = ref<HTMLIFrameElement>();
        const payload = ref<unknown>();
        const loading = ref(true);
        const ready = ref(false);
        const error = ref('');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        const origin = new URL(import.meta.env.VITE_STOREFRONT_ORIGIN || 'http://localhost:3000').origin;
        const siteName = computed(() => sdk.context?.site?.name || sdk.context?.workspace.name || '');
        let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
        const selectorOverride = route.query.workspaceId && route.query.siteId
            ? {
                workspaceId: String(route.query.workspaceId),
                siteId: String(route.query.siteId),
            }
            : undefined;

        function deliver() {
            if (ready.value && frame.value && payload.value) {
                sendPreview(frame.value, origin, payload.value);
            }
        }

        async function refresh() {
            loading.value = true;
            error.value = '';
            try {
                payload.value = await sdk.send({
                    url: '/api/v4/storefront/site-preview',
                    method: 'GET',
                    selectorOverride,
                });
                deliver();
                if (deliveryTimer) clearTimeout(deliveryTimer);
                deliveryTimer = setTimeout(deliver, 500);
            } catch (cause) {
                payload.value = undefined;
                error.value = (cause as Error).message || t('presets.sitePreviewError');
            } finally {
                loading.value = false;
            }
        }

        watch(payload, deliver);
        onMounted(refresh);
        onBeforeUnmount(() => { if (deliveryTimer) clearTimeout(deliveryTimer); });

        return () => <div class="flex h-screen min-h-[560px] flex-col bg-dark text-white">
            <header class="flex flex-wrap items-center gap-3 border-b border-white/20 px-4 py-3">
                <div class="mr-auto min-w-0">
                    <strong class="block truncate text-sm">{t('presets.sitePreviewTitle')}</strong>
                    <span class="block truncate text-xs text-white/60">{siteName.value}{loading.value ? ` · ${t('presets.sitePreviewLoading')}` : ''}</span>
                </div>
                <div class="flex rounded border border-white/20 p-1" role="group" aria-label={t('presets.viewport')}>
                    {(['desktop', 'mobile'] as const).map((value) => <button type="button"
                        aria-pressed={viewport.value === value}
                        onClick={() => { viewport.value = value; }}
                        class={`px-3 py-1.5 text-xs ${viewport.value === value ? 'bg-white text-dark' : 'text-white/75'}`}>
                        {t(`presets.${value}`)}
                    </button>)}
                </div>
                <button type="button" disabled={loading.value} onClick={refresh}
                    class="border border-white/25 px-3 py-2 text-xs disabled:opacity-40">
                    {t('presets.refreshPreview')}
                </button>
                <button type="button" onClick={() => window.close()}
                    class="border border-white/25 px-3 py-2 text-xs">
                    {t('common.close')}
                </button>
            </header>
            {error.value && <div role="alert" class="border-b border-red/60 bg-red/20 px-4 py-3 text-sm">
                {error.value}
            </div>}
            <div class="relative flex min-h-0 flex-1 justify-center overflow-hidden bg-black/40">
                {loading.value && <div class="absolute inset-0 z-10 grid place-items-center bg-dark/80 text-sm">
                    {t('presets.sitePreviewLoading')}
                </div>}
                <iframe ref={frame} title={t('presets.sitePreviewTitle')} src={`${origin}/preview`}
                    onLoad={() => { ready.value = true; deliver(); }}
                    class="h-full border-0 bg-white shadow-2xl transition-[width] duration-200"
                    style={{ width: viewport.value === 'mobile' ? '390px' : '100%', maxWidth: '100%' }} />
            </div>
        </div>;
    },
});

export default SitePreviewView;
