import { defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { createPublicationAction } from './gateway-publication';

interface Publication { requestKey?: string; operationId: string; releaseId: string; status: 'pending' | 'ready' | 'failed'; failureCode?: string }
interface GatewayInfo { configured: boolean; bound: boolean; siteUrl: string; publishStatus: Publication | null }

interface History {
    currentReleaseId: string;
    items: Array<{ _id: string; createdAt: number; createdBy: string; pageCount: number }>;
    audit: Array<{ createdAt: number; actorId: string; operation: string; releaseId: string; error: string }>;
}
interface Preflight {
    valid: boolean;
    expectedReleaseId: string;
    issues: string[];
    pageCount: number;
    diff: { added: string[]; changed: string[]; removed: string[]; navigationChanged: boolean;
        redirects: Array<{ from: string; to: string }> } | null;
}

export const ReleaseManager = defineComponent({
    props: { onSaved: { type: Function as PropType<() => Promise<void>>, required: true } },
    setup(props) {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const history = ref<History>({ currentReleaseId: '', items: [], audit: [] });
        const preflight = ref<Preflight | null>(null);
        const busy = ref(false);
        const error = ref('');
        const gateway = ref<GatewayInfo | null>(null);
        const publication = ref<Publication | null>(null);
        const action = createPublicationAction(sessionStorage,
            `${encodeURIComponent(sdk.context?.context.workspaceId || '')}/${encodeURIComponent(sdk.context?.context.siteId || '')}`,
            () => crypto.randomUUID());
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let disposed = false;
        const origin = new URL(import.meta.env.VITE_STOREFRONT_ORIGIN || 'http://localhost:3000').origin;
        function siteUrl() {
            try { const url = new URL(gateway.value?.siteUrl || ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
            catch { return ''; }
        }
        async function acceptPublication(value: Publication, notify = false) {
            publication.value = value;
            action.complete(value.status, value.requestKey);
            if (value.status === 'pending') schedulePoll();
            if (value.status === 'failed') preflight.value = null;
            if (value.status === 'ready' && notify) {
                preflight.value = null;
                await props.onSaved();
                window.bcms.notification.success(t('presets.releasePublished'));
            }
        }
        function schedulePoll() {
            if (pollTimer) clearTimeout(pollTimer);
            if (disposed || publication.value?.status !== 'pending') return;
            pollTimer = setTimeout(async () => {
                const id = publication.value?.operationId;
                if (!id) return;
                try {
                    const result = await sdk.send<{ id: string; releaseId: string; status: Publication['status']; failureCode?: string }>({
                        url: `/api/v4/presets/releases/gateway/operations/${encodeURIComponent(id)}`, method: 'GET',
                    });
                    if (disposed || publication.value?.operationId !== id) return;
                    error.value = '';
                    await acceptPublication({ ...publication.value, ...result, operationId: result.id }, true);
                } catch (cause) {
                    if (disposed) return;
                    error.value = (cause as Error).message;
                    schedulePoll();
                }
            }, 2500);
        }
        async function refresh() {
            const [local, info] = await Promise.all([
                sdk.send<History>({ url: '/api/v4/presets/releases/', method: 'GET' }),
                sdk.send<GatewayInfo>({ url: '/api/v4/presets/releases/gateway', method: 'GET' }),
            ]);
            history.value = local;
            gateway.value = info;
            if (info.bound && info.publishStatus) await acceptPublication(info.publishStatus);
        }
        async function run(action: () => Promise<void>) {
            if (busy.value) return;
            busy.value = true;
            error.value = '';
            try { await action(); }
            catch (cause) { error.value = (cause as Error).message; }
            finally { busy.value = false; }
        }
        async function check() {
            await run(async () => {
                preflight.value = null;
                await refresh();
                preflight.value = await sdk.send<Preflight>({ url: '/api/v4/presets/releases/check', method: 'POST' });
            });
        }
        async function publish() {
            if (!preflight.value?.valid || !gateway.value || publication.value?.status === 'pending') return;
            const expectedReleaseId = preflight.value.expectedReleaseId;
            await run(async () => {
                if (gateway.value?.bound) {
                    const requestKey = action.request();
                    let result: Publication;
                    try {
                        result = await sdk.send<Publication>({ url: '/api/v4/presets/releases/publish', method: 'POST',
                            data: { expectedReleaseId, target: 'gateway', requestKey } });
                    } catch (cause) {
                        await refresh().catch(() => undefined);
                        throw cause;
                    }
                    await acceptPublication({ ...result, requestKey }, true);
                    preflight.value = null;
                    return;
                }
                await sdk.send({ url: '/api/v4/presets/releases/publish', method: 'POST', data: { expectedReleaseId } });
                preflight.value = null;
                await refresh();
                await props.onSaved();
                window.bcms.notification.success(t('presets.releasePublished'));
            });
        }
        async function rollback(releaseId: string) {
            await run(async () => {
                await sdk.send({ url: '/api/v4/presets/releases/rollback', method: 'POST',
                    data: { releaseId, expectedReleaseId: history.value.currentReleaseId } });
                preflight.value = null;
                await refresh();
                await props.onSaved();
                window.bcms.notification.success(t('presets.releaseRestored'));
            });
        }
        onMounted(() => run(refresh));
        onBeforeUnmount(() => { disposed = true; if (pollTimer) clearTimeout(pollTimer); });
        return () => <section id="releases" class="mt-12 border-t border-gray/60 pt-8 dark:border-gray">
            <h2 class="text-lg font-semibold">{t('presets.releasesTitle')}</h2>
            <p class="mt-2 max-w-3xl text-sm opacity-70">{t(gateway.value?.bound ? 'presets.gatewayReleaseHint' : 'presets.releaseHint')}</p>
            {gateway.value?.bound && <p role="status" class="mt-3 text-sm">
                {publication.value ? t(`presets.gatewayStatus.${publication.value.status}`) : t('presets.gatewayNotPublished')}
                {publication.value?.failureCode && <span class="ml-2">{publication.value.failureCode}</span>}
            </p>}
            {gateway.value && !gateway.value.bound && <p class="mt-3 text-sm">{history.value.currentReleaseId
                ? t('presets.activeRelease', { id: history.value.currentReleaseId.slice(0, 8) }) : t('presets.noRelease')}</p>
            }
            <div class="mt-4 flex flex-wrap items-center gap-4">
                <Button disabled={busy.value || publication.value?.status === 'pending'} onClick={check}>{t(gateway.value?.bound ? 'presets.checkGatewayRelease' : 'presets.checkRelease')}</Button>
                <Button disabled={busy.value || !gateway.value || !preflight.value?.valid || publication.value?.status === 'pending'} onClick={publish}>{t('presets.publishRelease')}</Button>
                {gateway.value?.bound ? publication.value?.status === 'ready' && siteUrl() &&
                    <a href={siteUrl()} target="_blank" rel="noopener noreferrer" class="text-sm underline">{t('presets.openSite')}</a>
                    : history.value.currentReleaseId && <a href={origin} target="_blank" rel="noopener noreferrer" class="text-sm underline">{t('presets.openSite')}</a>}
            </div>
            {busy.value && <p role="status" class="mt-3 text-sm">{t('common.loading')}</p>}
            {error.value && <p role="alert" class="mt-3 text-sm text-red">{error.value}</p>}
            {preflight.value && <div class="mt-5 border border-gray/60 p-4 text-sm dark:border-gray">
                <strong>{preflight.value.valid ? t('presets.releaseValid', { count: preflight.value.pageCount }) : t('presets.releaseInvalid')}</strong>
                {preflight.value.issues.map((issue) => <p role="alert" class="mt-2 text-red">{issue}</p>)}
                {!gateway.value?.bound && preflight.value.diff && <div class="mt-3 grid gap-4 sm:grid-cols-3">
                    {(['added', 'changed', 'removed'] as const).map((kind) => <div>
                        <p class="font-medium">{t(`presets.releaseDiff.${kind}`)}</p>
                        {preflight.value!.diff![kind].map((path) => <p class="mt-1 break-all">{path}</p>)}
                        {!preflight.value!.diff![kind].length && <span class="opacity-60">—</span>}
                    </div>)}
                    {preflight.value.diff.navigationChanged && <p>{t('presets.navigationChanged')}</p>}
                    {!!preflight.value.diff.redirects.length && <div class="sm:col-span-3">
                        <p class="font-medium">{t('presets.redirects')}</p>
                        {preflight.value.diff.redirects.map((item) => <p class="mt-1">{item.from} → {item.to}</p>)}
                    </div>}
                </div>}
            </div>}
            {gateway.value && !gateway.value.bound && !!history.value.items.length && <div class="mt-6 overflow-x-auto">
                <table class="w-full text-left text-sm">
                    <thead><tr><th class="py-2">{t('presets.releaseVersion')}</th><th>{t('presets.releaseCreated')}</th>
                        <th>{t('presets.releaseActor')}</th><th>{t('presets.pagesTitle')}</th><th /></tr></thead>
                    <tbody>{history.value.items.map((item) => <tr class="border-t border-gray/40">
                        <td class="py-3">{item._id.slice(0, 8)} {item._id === history.value.currentReleaseId && t('presets.currentRelease')}</td>
                        <td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.createdBy}</td><td>{item.pageCount}</td>
                        <td>{item._id !== history.value.currentReleaseId && <Button disabled={busy.value}
                            onClick={() => rollback(item._id)}>{t('presets.rollbackRelease')}</Button>}</td>
                    </tr>)}</tbody>
                </table>
            </div>}
            {gateway.value && !gateway.value.bound && !!history.value.audit.length && <details class="mt-5 text-sm">
                <summary class="cursor-pointer">{t('presets.releaseAudit')}</summary>
                {history.value.audit.map((event) => <p class={`mt-2 ${event.error ? 'text-red' : ''}`}>
                    {new Date(event.createdAt).toLocaleString()} · {event.actorId} · {event.operation} · {event.releaseId.slice(0, 8)}
                    {event.error ? ` · ${event.error}` : ` · ${t('presets.releaseSuccess')}`}
                </p>)}
            </details>}
        </section>;
    },
});
