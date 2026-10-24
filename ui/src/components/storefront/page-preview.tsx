import {
    computed, defineComponent, onBeforeUnmount, onMounted, ref, Teleport, watch,
    type PropType,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { availablePreviewPages, buildPagePreviewRequest,
    type PreviewSiteContext } from '@bcms/selfhosted-ui/util/page-preview';
import { createPreviewGate, sendPreview } from './preview-state';

export const PagePreview = defineComponent({
    props: {
        entry: { type: Object as PropType<Entry>, required: true },
        site: { type: Object as PropType<PreviewSiteContext>, required: true },
        language: { type: String, required: true },
    },
    setup(props) {
        const { t } = useI18n();
        const origin = new URL(import.meta.env.VITE_STOREFRONT_ORIGIN || 'http://localhost:3000').origin;
        const pages = computed(() => availablePreviewPages(props.site, props.entry.templateId));
        const selectedPage = ref('');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        const open = ref(false);
        const frame = ref<HTMLIFrameElement>();
        const frameReady = ref(false);
        const loading = ref(false);
        const error = ref('');
        const payload = ref<unknown>();
        const gate = createPreviewGate();
        const refreshTick = ref(0);
        function refreshCapabilities() {
            if (document.visibilityState === 'visible') refreshTick.value++;
        }
        const capabilityRefresh = setInterval(refreshCapabilities, 5 * 60000);
        onMounted(() => document.addEventListener('visibilitychange', refreshCapabilities));
        let timeout: ReturnType<typeof setTimeout> | undefined;

        function deliver() {
            if (frameReady.value && frame.value && payload.value) {
                sendPreview(frame.value, origin, payload.value);
            }
        }

        function close() {
            open.value = false;
            gate.next();
            if (timeout) clearTimeout(timeout);
            frameReady.value = false;
            payload.value = undefined;
            loading.value = false;
            error.value = '';
        }

        function onKeydown(event: KeyboardEvent) {
            if (event.key === 'Escape' && open.value) close();
        }

        watch(pages, (items) => {
            if (!items.some((page) => page.key === selectedPage.value)) {
                selectedPage.value = items[0]?.key || '';
            }
        }, { immediate: true });

        watch([() => props.entry, () => props.language, selectedPage, open, refreshTick], () => {
            const sequence = gate.next();
            if (timeout) clearTimeout(timeout);
            if (!open.value || !selectedPage.value) return;
            timeout = setTimeout(async () => {
                loading.value = true;
                try {
                    const result = await window.bcms.sdk.send<unknown>({
                        url: '/api/v4/storefront/page-preview', method: 'POST',
                        data: buildPagePreviewRequest(props.site, props.entry, selectedPage.value, props.language),
                    });
                    if (gate.isCurrent(sequence)) {
                        payload.value = result;
                        error.value = '';
                        deliver();
                    }
                } catch (cause) {
                    if (gate.isCurrent(sequence)) {
                        payload.value = undefined;
                        error.value = (cause as Error).message || t('storefrontPreview.error');
                    }
                } finally {
                    if (gate.isCurrent(sequence)) loading.value = false;
                }
            }, 350);
        }, { deep: true });

        onMounted(() => window.addEventListener('keydown', onKeydown));
        onBeforeUnmount(() => {
            clearInterval(capabilityRefresh);
            document.removeEventListener('visibilitychange', refreshCapabilities);
            close();
            window.removeEventListener('keydown', onKeydown);
        });

        return () => <>
            <Button onClick={() => { open.value = true; }} disabled={!pages.value.length}>
                {t('storefrontPreview.open')}
            </Button>
            {open.value && <Teleport to="body">
                <aside class="fixed inset-0 z-[1000] flex flex-col bg-dark text-white xl:inset-y-0 xl:left-auto xl:right-0 xl:w-1/2 xl:max-w-[960px] xl:border-l xl:border-white/20 xl:shadow-2xl"
                    role="complementary" aria-label={t('storefrontPreview.title')}>
                    <div class="flex flex-wrap items-center gap-3 border-b border-white/20 bg-dark px-4 py-3">
                        <strong class="mr-auto text-sm">{t('storefrontPreview.title')}</strong>
                        <label class="text-xs">
                            <span class="sr-only">{t('storefrontPreview.page')}</span>
                            <select value={selectedPage.value} onChange={(event) => {
                                selectedPage.value = (event.target as HTMLSelectElement).value;
                            }} class="rounded border border-white/30 bg-dark px-2 py-2 text-white">
                                {pages.value.map((page) => <option value={page.key}>{page.title}</option>)}
                            </select>
                        </label>
                        <div class="flex border border-white/30" role="group" aria-label={t('presets.viewport')}>
                            {(['desktop', 'mobile'] as const).map((value) => <button type="button"
                                aria-pressed={viewport.value === value}
                                class={`px-3 py-2 text-xs ${viewport.value === value ? 'bg-white text-dark' : 'text-white'}`}
                                onClick={() => { viewport.value = value; }}>
                                {t(`presets.${value}`)}
                            </button>)}
                        </div>
                        <span class="min-w-[75px] text-right text-xs" aria-live="polite">
                            {loading.value ? t('storefrontPreview.updating') : t('storefrontPreview.draft')}
                        </span>
                        <button type="button" class="border border-white/30 px-3 py-2 text-xs" onClick={close}>
                            {t('common.close')}
                        </button>
                    </div>
                    {error.value && <p class="m-0 bg-red px-4 py-2 text-sm" role="alert">{error.value}</p>}
                    <div class="flex min-h-0 flex-1 justify-center overflow-auto bg-gray/30 p-3 sm:p-6">
                        <iframe ref={frame} title={t('storefrontPreview.title')} src={`${origin}/preview`}
                            class="h-full min-h-[480px] max-w-full border-0 bg-white shadow-lg"
                            style={{ width: viewport.value === 'mobile' ? '390px' : '1100px' }}
                            onLoad={() => { frameReady.value = true; deliver(); }} />
                    </div>
                </aside>
            </Teleport>}
        </>;
    },
});
