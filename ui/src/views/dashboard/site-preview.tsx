import { userErrorMessage } from '@bcms/selfhosted-ui/util/user-message';
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { isPreviewOriginRequest, isPreviewReady, loadPreviewRuntime, resolvePreviewTarget, sendPreviewOrigin, sendRendererPreview, type PreviewRuntime } from '@bcms/selfhosted-ui/util/template-preview';

export const SitePreviewView = defineComponent({
    setup() {
        const { t } = useI18n();
        const route = useRoute();
        const sdk = window.bcms.sdk;
        const frame = ref<HTMLIFrameElement>();
        const payload = ref<unknown>();
        const runtime = ref<PreviewRuntime | null>(null);
        const loading = ref(true);
        const ready = ref(false);
        const error = ref('');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        const connectionError = ref('');
        const target = computed(() => resolvePreviewTarget(payload.value, {
            templateOrigin: import.meta.env.VITE_TEMPLATE_PREVIEW_ORIGIN,
            legacyOrigin: import.meta.env.VITE_STOREFRONT_ORIGIN,
            renderers: import.meta.env.VITE_TEMPLATE_PREVIEW_RENDERERS,
        }, runtime.value));
        const siteName = computed(() => sdk.context?.site?.name || sdk.context?.workspace.name || '');
        let connectionTimer: ReturnType<typeof setTimeout> | undefined;
        let requestSequence = 0;
        const selectorOverride = computed(() => route.query.workspaceId && route.query.siteId
            ? {
                workspaceId: String(route.query.workspaceId),
                siteId: String(route.query.siteId),
            }
            : undefined);

        function deliver() {
            if (ready.value && frame.value && payload.value && target.value.origin) {
                sendRendererPreview(frame.value, target.value.origin, payload.value);
            }
        }
        function onReady(event: MessageEvent) {
            const expected = target.value.mode === 'template' && target.value.templateId && target.value.templateVersion
                ? { id: target.value.templateId, version: target.value.templateVersion }
                : undefined;
            if (isPreviewOriginRequest(event, frame.value, target.value.origin, expected)) {
                if (expected)
                    sendPreviewOrigin(frame.value, target.value.origin!, expected);
                return;
            }
            if (!isPreviewReady(event, frame.value, target.value.origin, expected)) return;
            ready.value = true;
            connectionError.value = '';
            clearTimeout(connectionTimer);
            deliver();
        }
        function onFrameLoad() {
            if (ready.value) { deliver(); return; }
            clearTimeout(connectionTimer);
            connectionTimer = setTimeout(() => {
                connectionError.value = '预览服务未完成版本握手。请刷新重试；若持续失败，请管理员检查渲染器版本、预览域名及嵌入策略。';
            }, 10000);
        }
        watch(frame, value => { if (value && !ready.value) onFrameLoad(); });
        watch(() => `${target.value.mode}:${target.value.origin || ''}:${target.value.templateId || ''}:${target.value.templateVersion || ''}:${target.value.digest || ''}`, () => {
            ready.value = false;
            connectionError.value = '';
            clearTimeout(connectionTimer);
        });
        async function refresh() {
            const sequence = ++requestSequence;
            loading.value = true;
            error.value = '';
            connectionError.value = '';
            ready.value = false;
            payload.value = undefined;
            runtime.value = null;
            clearTimeout(connectionTimer);
            try {
                const result = await sdk.send({
                    url: '/api/v4/storefront/site-preview', method: 'GET', selectorOverride: selectorOverride.value,
                });
                const serviceRuntime = await loadPreviewRuntime(result,
                    url => sdk.send({ url, method: 'GET', selectorOverride: selectorOverride.value }));
                if (sequence === requestSequence) {
                    payload.value = result;
                    runtime.value = serviceRuntime;
                }
            } catch (cause) {
                if (sequence === requestSequence) error.value = userErrorMessage(cause);
            } finally {
                if (sequence === requestSequence) loading.value = false;
            }
        }
        watch(selectorOverride, () => { void refresh(); }, { flush: 'sync' });
        onMounted(() => { window.addEventListener('message', onReady); refresh(); });
        onBeforeUnmount(() => { requestSequence++; clearTimeout(connectionTimer); window.removeEventListener('message', onReady); });

        return () => <div class="cms-preview-page">
            <header class="flex flex-wrap items-center gap-3 border-b border-white/20 px-4 py-3">
                <div class="mr-auto min-w-0">
                    <strong class="block truncate text-sm">{t('presets.sitePreviewTitle')}</strong>
                    <span class="block truncate text-xs text-white/60">{siteName.value}{loading.value ? ` · ${t('presets.sitePreviewLoading')}` : ''}</span>
                </div>
                <div class="flex rounded border border-white/20 p-1" role="group" aria-label={t('presets.viewport')}>
                    {(['desktop', 'mobile'] as const).map((value) => <button type="button"
                        aria-pressed={viewport.value === value}
                        onClick={() => { viewport.value = value; }}
                        class={`min-h-[44px] px-3 py-1.5 text-xs ${viewport.value === value ? 'bg-white text-dark' : 'text-white/75'}`}>
                        {t(`presets.${value}`)}
                    </button>)}
                </div>
                <button type="button" disabled={loading.value} onClick={refresh}
                    class="min-h-[44px] border border-white/25 px-3 py-2 text-xs disabled:opacity-40">
                    {t('presets.refreshPreview')}
                </button>
                <button type="button" onClick={() => window.close()}
                    class="min-h-[44px] border border-white/25 px-3 py-2 text-xs">
                    {t('common.close')}
                </button>
            </header>
            {error.value && <div role="alert" class="border-b border-red/60 bg-error px-4 py-3 text-sm leading-relaxed text-dark">
                {error.value}
            </div>}
            {!loading.value && payload.value && <div role="status" class="border-b border-white/20 px-4 py-3 text-sm leading-relaxed">{target.value.mode === 'template' && !ready.value ? `${target.value.templateId} ${target.value.templateVersion} · 正在核对预览服务，草稿尚未发送。` : target.value.notice}{['unsupported', 'config-error'].includes(target.value.mode) && <a class="ml-3 underline" href="/d/presets">前往模板管理</a>}</div>}
            {connectionError.value && <p role="alert" class="m-0 border-b border-red/60 bg-error px-4 py-3 text-sm text-dark">{connectionError.value}</p>}
            <div class="relative flex min-h-0 flex-1 justify-center overflow-hidden bg-black/40">
                {(loading.value || (target.value.origin && !ready.value && !connectionError.value)) && <div class="absolute inset-0 z-10 grid place-items-center bg-dark/80 text-sm">
                    <span role="status">{loading.value ? t('presets.sitePreviewLoading') : '正在连接并核对预览服务版本…'}</span>
                </div>}
                {target.value.origin && payload.value && <iframe key={`${target.value.templateId || target.value.mode}@${target.value.templateVersion || ''}:${target.value.digest || target.value.origin}`} ref={frame} title={t('presets.sitePreviewTitle')} src={target.value.url || `${target.value.origin}/preview`}
                    onLoad={onFrameLoad}
                    sandbox="allow-scripts allow-same-origin"
                    referrerpolicy="no-referrer"
                    class="h-full border-0 bg-white shadow-2xl transition-[width] duration-200"
                    style={{ width: viewport.value === 'mobile' ? '390px' : '100%', maxWidth: '100%' }} />}
            </div>
        </div>;
    },
});

export default SitePreviewView;
