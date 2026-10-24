import { CopyProvenance } from '@bcms/selfhosted-ui/components/workspace/provenance';
import { computed, defineComponent, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { ShareKind } from '@bcms/selfhosted-backend/resource-shares/repo';
import type { EntryGroup } from '@bcms/selfhosted-backend/entry-groups/repo';
import type { Workspace } from '@bcms/selfhosted-backend/workspaces/repo';
import { Button } from '@bcms/selfhosted-ui/components/button';
import {
    ShareCopy,
    type ShareSummary,
} from '@bcms/selfhosted-ui/components/workspace/share-copy';
import {
    errorMessage,
    formClass,
    panelClass,
} from '@bcms/selfhosted-ui/components/workspace/common';

export default defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const kinds: ShareKind[] = ['Entry', 'Media', 'Widget', 'Group'];
        const kind = ref<ShareKind>(
            kinds.includes(route.query.type as ShareKind)
                ? (route.query.type as ShareKind)
                : 'Entry',
        );
        const resourceId = ref(
            typeof route.query.id === 'string' ? route.query.id : '',
        );
        const targetWorkspace = ref('');
        const incoming = ref<ShareSummary[]>([]);
        const outgoing = ref<ShareSummary[]>([]);
        const groups = ref<EntryGroup[]>([]);
        const workspaces = ref<Workspace[]>([]);
        const busy = ref(false);
        const error = ref('');
        const success = ref('');
        const admin = !!sdk.context?.context.admin;
        const resources = computed(() => {
            if (kind.value === 'Entry')
                return sdk.store.entryLite
                    .items()
                    .map((item) => ({
                        id: item._id,
                        name: `${item.info[0]?.title || item._id} · ${
                            sdk.store.template.findById(item.templateId)
                                ?.label || item.templateId
                        }`,
                    }));
            if (kind.value === 'Media')
                return sdk.store.media
                    .items()
                    .filter((item) => item.type !== 'DIR')
                    .map((item) => ({ id: item._id, name: item.name }));
            return (
                kind.value === 'Widget' ? sdk.store.widget : sdk.store.group
            )
                .items()
                .map((item) => ({ id: item._id, name: item.label }));
        });
        const selectedResource = computed(() => {
            if (kind.value === 'Entry')
                return sdk.store.entryLite.findById(resourceId.value);
            if (kind.value === 'Media')
                return sdk.store.media.findById(resourceId.value);
            return (
                kind.value === 'Widget' ? sdk.store.widget : sdk.store.group
            ).findById(resourceId.value);
        });
        async function refresh() {
            incoming.value = (
                await sdk.send<{ items: ShareSummary[] }>({
                    url: '/api/v4/resource-shares/incoming',
                })
            ).items;
            if (admin)
                outgoing.value = (
                    await sdk.send<{ items: ShareSummary[] }>({
                        url: '/api/v4/resource-shares/outgoing',
                    })
                ).items;
        }
        async function run(action: () => Promise<unknown>) {
            if (busy.value) return;
            busy.value = true;
            error.value = '';
            try {
                await action();
            } catch (cause) {
                error.value = `${errorMessage(cause)} ${
                    (cause as { status?: number }).status === 409
                        ? t('shares.conflict')
                        : ''
                }`;
            } finally {
                try {
                    await refresh();
                } catch (cause) {
                    error.value = [error.value, errorMessage(cause)]
                        .filter(Boolean)
                        .join(' · ');
                }
                busy.value = false;
            }
        }
        onMounted(() =>
            run(async () => {
                workspaces.value = (
                    await sdk.send<{ items: Workspace[] }>({
                        url: '/api/v4/workspaces',
                    })
                ).items;
                groups.value = (
                    await sdk.send<{ items: EntryGroup[] }>({
                        url: '/api/v4/entry-groups/',
                    })
                ).items;
                const loaded = await Promise.allSettled([
                    sdk.template.getAll(),
                    sdk.entry.getAllLite(),
                    sdk.media.getAll(),
                    sdk.widget.getAll(),
                    sdk.group.getAll(),
                ]);
                const failures = loaded.filter(
                    (item): item is PromiseRejectedResult =>
                        item.status === 'rejected',
                );
                if (failures.length)
                    error.value = failures
                        .map((item) => errorMessage(item.reason))
                        .join(' · ');
            }),
        );
        return () => (
            <div class="max-w-5xl">
                <h1 class="text-2xl font-semibold">{t('workspace.shares')}</h1>
                <p class="mt-2 text-sm opacity-70">{t('shares.independent')}</p>
                {error.value && (
                    <p role="alert" class="mt-4 text-sm text-red">
                        {error.value}
                    </p>
                )}
                {success.value && (
                    <p role="status" class="mt-4 text-sm">
                        {success.value}
                    </p>
                )}
                {admin && (
                    <form
                        class={panelClass}
                        onSubmit={(event) => {
                            event.preventDefault();
                            run(async () => {
                                await sdk.send({
                                    url: '/api/v4/resource-shares/',
                                    method: 'POST',
                                    data: {
                                        resourceType: kind.value,
                                        resourceId: resourceId.value,
                                        targetWorkspaceId:
                                            targetWorkspace.value.trim(),
                                    },
                                });
                                success.value = t('shares.granted');
                            });
                        }}
                    >
                        <h2 class="text-lg font-semibold">
                            {t('shares.grant')}
                        </h2>
                        <p class="mt-2 text-sm opacity-70">
                            {t('shares.grantHint')}
                        </p>
                        <div class="mt-4 grid gap-4 sm:grid-cols-2">
                            <label class="text-sm">
                                {t('shares.resourceType')}
                                <select
                                    class={`${formClass} mt-2 block w-full`}
                                    value={kind.value}
                                    disabled={busy.value}
                                    onChange={(event) => {
                                        kind.value = (
                                            event.target as HTMLSelectElement
                                        ).value as ShareKind;
                                        resourceId.value = '';
                                    }}
                                >
                                    {kinds.map((value) => (
                                        <option value={value}>{value}</option>
                                    ))}
                                </select>
                            </label>
                            <label class="text-sm">
                                {t('shares.resource')}
                                <select
                                    class={`${formClass} mt-2 block w-full`}
                                    value={resourceId.value}
                                    required
                                    disabled={busy.value}
                                    onChange={(event) => {
                                        resourceId.value = (
                                            event.target as HTMLSelectElement
                                        ).value;
                                    }}
                                >
                                    <option value="">
                                        {t('shares.chooseResource')}
                                    </option>
                                    {resources.value.map((item) => (
                                        <option value={item.id}>
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label class="text-sm sm:col-span-2">
                                {t('shares.targetWorkspace')}
                                <input
                                    class={`${formClass} mt-2 block w-full`}
                                    list="share-workspaces"
                                    value={targetWorkspace.value}
                                    required
                                    disabled={busy.value}
                                    onInput={(event) => {
                                        targetWorkspace.value = (
                                            event.target as HTMLInputElement
                                        ).value;
                                    }}
                                />
                                <datalist id="share-workspaces">
                                    {workspaces.value
                                        .filter(
                                            (item) =>
                                                item._id !==
                                                sdk.context?.context
                                                    .workspaceId,
                                        )
                                        .map((item) => (
                                            <option value={item._id}>
                                                {item.name}
                                            </option>
                                        ))}
                                </datalist>
                            </label>
                        </div>
                        <CopyProvenance
                            value={selectedResource.value?.provenance}
                        />
                        <p class="mt-2 text-xs opacity-70">
                            {t('shares.targetHint')}
                        </p>
                        <Button
                            type="submit"
                            class="mt-4"
                            disabled={
                                busy.value ||
                                !resourceId.value ||
                                !targetWorkspace.value.trim()
                            }
                        >
                            {t('shares.grant')}
                        </Button>
                    </form>
                )}
                <div class="mt-6 flex items-center justify-between gap-3">
                    <h2 class="font-semibold">{t('shares.incoming')}</h2>
                    <Button
                        disabled={busy.value}
                        onClick={() => run(async () => undefined)}
                    >
                        {t('workspace.refresh')}
                    </Button>
                </div>
                <p class="mt-2 text-sm opacity-70">{t('shares.revokedHint')}</p>
                {incoming.value.map((item) => (
                    <div class="mt-3 border-b border-gray/50 pb-3 text-sm">
                        <strong>{item.resourceType}</strong> ·{' '}
                        <code class="break-all">{item.resourceId}</code> ·{' '}
                        {t(`shares.states.${item.state}`)}
                        <p class="text-xs opacity-70 break-all">
                            {t('shares.source', {
                                workspace: item.ownerWorkspaceId,
                                version: item.version,
                            })}
                        </p>
                    </div>
                ))}
                <ShareCopy
                    items={incoming.value}
                    groups={groups.value}
                    onCopied={refresh}
                />
                {admin && (
                    <section class={panelClass}>
                        <h2 class="font-semibold">{t('shares.outgoing')}</h2>
                        {outgoing.value.map((item) => (
                            <article class="mt-4 border-b border-gray/50 pb-4 text-sm">
                                <p>
                                    <strong>{item.resourceType}</strong> ·{' '}
                                    <code class="break-all">
                                        {item.resourceId}
                                    </code>{' '}
                                    · {t(`shares.states.${item.state}`)}
                                </p>
                                <p class="mt-1 break-all text-xs opacity-70">
                                    {t('shares.toWorkspace', {
                                        workspace: item.targetWorkspaceId,
                                    })}
                                </p>
                                <code class="mt-1 block break-all text-xs">
                                    {item.version}
                                </code>
                                <p class="mt-1 text-xs opacity-70">
                                    {item.audit
                                        .map(
                                            (event) =>
                                                `${event.operation} · ${
                                                    event.actorId
                                                } · ${new Date(
                                                    event.at,
                                                ).toLocaleString()}`,
                                        )
                                        .join(' / ')}
                                </p>
                                <Button
                                    class="mt-3"
                                    kind="danger"
                                    disabled={
                                        busy.value || item.state === 'revoked'
                                    }
                                    onClick={async () => {
                                        if (
                                            await window.bcms.confirm(
                                                t('shares.revoke'),
                                                t('shares.revokeConfirm'),
                                            )
                                        )
                                            await run(() =>
                                                sdk.send({
                                                    url: `/api/v4/resource-shares/${encodeURIComponent(
                                                        item._id,
                                                    )}`,
                                                    method: 'DELETE',
                                                }),
                                            );
                                    }}
                                >
                                    {t('shares.revoke')}
                                </Button>
                            </article>
                        ))}
                    </section>
                )}
            </div>
        );
    },
});
