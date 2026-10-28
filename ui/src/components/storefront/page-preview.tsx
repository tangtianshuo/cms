import { userErrorMessage } from '@bcms/selfhosted-ui/util/user-message';
import {
    computed, defineComponent, onBeforeUnmount, onMounted, ref, Teleport, watch,
    type PropType,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { availablePreviewPages, buildPagePreviewRequest,
    type PreviewSiteContext } from '@bcms/selfhosted-ui/util/page-preview';
import { createPreviewGate } from './preview-state';
import { isPreviewReady, overlayPagePreview, resolvePreviewTarget, sendRendererPreview } from '@bcms/selfhosted-ui/util/template-preview';

export const PagePreview = defineComponent({
    props: {
        entry: { type: Object as PropType<Entry>, required: true },
        site: { type: Object as PropType<PreviewSiteContext>, required: true },
        language: { type: String, required: true },
    },
    setup(props) {
        const { t } = useI18n();
        const config = {
            templateOrigin: import.meta.env.VITE_TEMPLATE_PREVIEW_ORIGIN,
            legacyOrigin: import.meta.env.VITE_STOREFRONT_ORIGIN,
        };
        const pages = computed(() => availablePreviewPages(props.site, props.entry.templateId));
        const selectedPage = ref('');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        const open = ref(false);
        const frame = ref<HTMLIFrameElement>();
        const frameReady = ref(false);
        const loading = ref(false);
        const error = ref('');
        const payload = ref<unknown>();
        const selectedPath = ref<string>();
        const connectionError = ref('');
        const target = computed(() => resolvePreviewTarget(payload.value, config));
        let connectionTimer: ReturnType<typeof setTimeout> | undefined;
        const gate = createPreviewGate();
        const refreshTick = ref(0);
        function refreshCapabilities() {
            if (document.visibilityState === 'visible') refreshTick.value++;
        }
        const capabilityRefresh = setInterval(refreshCapabilities, 5 * 60000);
        onMounted(() => document.addEventListener('visibilitychange', refreshCapabilities));
        let timeout: ReturnType<typeof setTimeout> | undefined;

        function deliver() {
            if (frameReady.value && frame.value && payload.value && target.value.origin) {
                sendRendererPreview(frame.value, target.value.origin, payload.value, selectedPath.value);
            }
        }

        function onReady(event: MessageEvent) {
            if (!isPreviewReady(event, frame.value, target.value.origin, target.value.mode === 'template')) return;
            frameReady.value = true;
            connectionError.value = '';
            clearTimeout(connectionTimer);
            deliver();
        }
        function onFrameLoad() {
            if (frameReady.value) { deliver(); return; }
            clearTimeout(connectionTimer);
            connectionTimer = setTimeout(() => {
                connectionError.value = '预览服务未完成版本握手。请关闭后重试；若持续失败，请管理员检查渲染器版本和嵌入策略。';
            }, 10000);
        }
        function installPayload(value: unknown, path?: string) {
            const next = resolvePreviewTarget(value, config);
            if (next.origin !== target.value.origin || next.mode !== target.value.mode) {
                frameReady.value = false;
                connectionError.value = '';
                clearTimeout(connectionTimer);
            }
            selectedPath.value = path;
            payload.value = value;
            deliver();
        }
        watch(frame, value => { if (value && !frameReady.value) onFrameLoad(); });
        function close() {
            open.value = false;
            gate.next();
            if (timeout) clearTimeout(timeout);
            clearTimeout(connectionTimer);
            connectionError.value = '';
            selectedPath.value = undefined;
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
                    let nextPayload: unknown = result;
                    let path: string | undefined;
                    if (resolvePreviewTarget(result, config).mode === 'template') {
                        const saved = await window.bcms.sdk.send<unknown>({ url: '/api/v4/storefront/site-preview', method: 'GET' });
                        const overlay = overlayPagePreview(saved, result, { pageKey: selectedPage.value,
                            entryId: props.entry._id, language: props.language,
                            settings: props.site.models.find(model => model.templateId === props.entry.templateId)?.key === 'site-settings' });
                        nextPayload = overlay.payload;
                        path = overlay.path;
                    }
                    if (gate.isCurrent(sequence)) {
                        installPayload(nextPayload, path);
                        error.value = '';
                    }
                } catch (cause) {
                    if (gate.isCurrent(sequence)) {
                        installPayload(undefined);
                        error.value = userErrorMessage(cause);
                    }
                } finally {
                    if (gate.isCurrent(sequence)) loading.value = false;
                }
            }, 350);
        }, { deep: true });

        onMounted(() => { window.addEventListener('keydown', onKeydown); window.addEventListener('message', onReady); });
        onBeforeUnmount(() => {
            clearInterval(capabilityRefresh);
            document.removeEventListener('visibilitychange', refreshCapabilities);
            close();
            window.removeEventListener('keydown', onKeydown);
            window.removeEventListener('message', onReady);
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
                                class={`min-h-[44px] px-3 py-2 text-xs ${viewport.value === value ? 'bg-white text-dark' : 'text-white'}`}
                                onClick={() => { viewport.value = value; }}>
                                {t(`presets.${value}`)}
                            </button>)}
                        </div>
                        <span class="min-w-[75px] text-right text-xs" aria-live="polite">
                            {loading.value ? t('storefrontPreview.updating') : t('storefrontPreview.draft')}
                        </span>
                        <button type="button" class="min-h-[44px] border border-white/30 px-3 py-2 text-xs" onClick={close}>
                            {t('common.close')}
                        </button>
                    </div>
                    {error.value && <p class="m-0 border-l-4 border-red bg-error px-4 py-2 text-sm leading-relaxed text-dark" role="alert">{error.value}</p>}
                    {payload.value && <p role="status" class="m-0 border-b border-white/20 px-4 py-3 text-sm leading-relaxed">{target.value.mode === 'template' && !frameReady.value ? 'AeroFrame 1.0.3 · 正在核对预览服务，草稿尚未发送。' : target.value.notice}{target.value.mode === 'template' && frameReady.value && ' 当前页包含未保存的编辑；路径和关联卡片使用已保存的站点草稿。'}{target.value.mode === 'unsupported' && <a href="/d/presets" class="ml-3 underline">前往模板管理</a>}</p>}
                    {connectionError.value && <p role="alert" class="m-0 border-b border-red bg-error px-4 py-3 text-sm text-dark">{connectionError.value}</p>}
                    <div class="relative flex min-h-0 flex-1 justify-center overflow-auto bg-gray/30 p-3 sm:p-6">
                        {target.value.origin && !frameReady.value && !connectionError.value && <p role="status" class="absolute left-0 right-0 top-0 z-10 bg-dark/90 p-3 text-center text-sm">正在连接并核对预览服务版本…</p>}
                        {target.value.origin && payload.value && <iframe ref={frame} title={t('storefrontPreview.title')} src={`${target.value.origin}/preview`}
                            class="h-full min-h-[480px] max-w-full border-0 bg-white shadow-lg"
                            style={{ width: viewport.value === 'mobile' ? '390px' : '1100px' }}
                            onLoad={onFrameLoad} />}
                    </div>
                </aside>
            </Teleport>}
        </>;
    },
});
