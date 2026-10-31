import { defineComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { siteSetupHref } from '../../layouts/dashboard/navigation';
import type { Workspace } from '@bcms/selfhosted-backend/workspaces/repo';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
import { Button } from '@bcms/selfhosted-ui/components/button';
import {
    errorMessage,
    formClass,
    panelClass,
} from '@bcms/selfhosted-ui/components/workspace/common';

export default defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const workspaces = ref<Workspace[]>([]);
        const sites = ref<SiteInstallation[]>([]);
        const error = ref('');
        const busy = ref(false);
        const name = ref('');
        const siteName = ref('');
        const rename = ref(sdk.context?.workspace.name || '');
        const memberId = ref('');
        const role = ref<'admin' | 'editor' | 'viewer'>('editor');
        const current = ref(sdk.context?.workspace);
        const instanceAdmin = () =>
            sdk.accessToken?.payload.rls.some(
                (assignedRole) => assignedRole === 'ADMIN' || assignedRole === 'SUDO',
            );
        const admin = () => !!sdk.context?.context.admin;

        async function refresh() {
            const result = await sdk.send<{ items: Workspace[] }>({
                url: '/api/v4/workspaces',
                selectorOverride: { workspaceId: 'default' },
            });
            workspaces.value = result.items;
            if (sdk.context) {
                const [context, list] = await Promise.all([
                    sdk.send<{ workspace: Workspace }>({
                        url: '/api/v4/workspaces/current',
                    }),
                    sdk.send<{ items: SiteInstallation[] }>({
                        url: '/api/v4/workspaces/current/sites',
                    }),
                ]);
                current.value = context.workspace;
                sites.value = list.items;
            }
        }
        async function run(action: () => Promise<unknown>) {
            if (busy.value) return;
            busy.value = true;
            error.value = '';
            try {
                await action();
                await refresh();
            } catch (cause) {
                error.value = errorMessage(cause);
            } finally {
                busy.value = false;
            }
        }
        async function removeMember(id: string) {
            if (
                await window.bcms.confirm(
                    t('workspace.removeMember'),
                    t('workspace.removeMemberConfirm', { id }),
                )
            ) {
                await run(() =>
                    sdk.send({
                        url: `/api/v4/workspaces/current/members/${encodeURIComponent(
                            id,
                        )}`,
                        method: 'DELETE',
                    }),
                );
            }
        }
        onMounted(() => run(async () => undefined));
        return () => (
            <div class="max-w-5xl">
                <h1 class="text-2xl font-semibold">
                    {t('workspace.workspaces')}
                </h1>
                <p class="mt-2 text-sm opacity-70">
                    {t('workspace.scopeHint')}
                </p>
                {!sdk.context && (
                    <p role="alert" class="mt-4 border-l-4 border-red p-3">
                        {t('workspace.recoveryHint')}
                    </p>
                )}
                {error.value && (
                    <p role="alert" class="mt-4 text-red">
                        {error.value}
                    </p>
                )}
                <section class={panelClass}>
                    <h2 class="font-semibold">
                        {t('workspace.chooseWorkspace')}
                    </h2>
                    <div class="mt-4 flex flex-wrap gap-3">
                        {workspaces.value.map((item) => (
                            <Button
                                disabled={busy.value}
                                onClick={() =>
                                    run(() =>
                                        sdk.selectContext(
                                            { workspaceId: item._id },
                                            '/d/workspaces',
                                        ),
                                    )
                                }
                            >
                                {item.name}
                                {sdk.context?.context.workspaceId === item._id
                                    ? ` · ${t('workspace.current')}`
                                    : ''}
                            </Button>
                        ))}
                    </div>
                </section>
                {instanceAdmin() && (
                    <section class={panelClass}>
                        <h2 class="font-semibold">
                            {t('workspace.createWorkspace')}
                        </h2>
                        <form
                            class="mt-4 flex flex-wrap gap-3"
                            onSubmit={(event) => {
                                event.preventDefault();
                                run(async () => {
                                    const workspace = await sdk.send<Workspace>(
                                        {
                                            url: '/api/v4/workspaces',
                                            method: 'POST',
                                            data: { name: name.value.trim() },
                                            selectorOverride: {
                                                workspaceId: 'default',
                                            },
                                        },
                                    );
                                    await sdk.selectContext(
                                        { workspaceId: workspace._id },
                                        '/d/workspaces',
                                    );
                                });
                            }}
                        >
                            <input
                                aria-label={t('workspace.name')}
                                class={formClass}
                                value={name.value}
                                required
                                maxlength={80}
                                onInput={(event) => {
                                    name.value = (
                                        event.target as HTMLInputElement
                                    ).value;
                                }}
                            />
                            <Button
                                type="submit"
                                disabled={busy.value || !name.value.trim()}
                            >
                                {t('common.create')}
                            </Button>
                        </form>
                    </section>
                )}
                {sdk.context && (
                    <>
                        <section class={panelClass}>
                            <h2 class="font-semibold">
                                {t('workspace.sites')} · {current.value?.name}
                            </h2>
                            <p class="mt-2 text-sm opacity-70">
                                {t('workspace.siteHint')}
                            </p>
                            <div class="mt-4 grid gap-3 sm:grid-cols-2">
                                {sites.value.map((site) => (
                                    <div class="border border-gray/50 p-4">
                                        <strong>{site.name}</strong>
                                        <p class="text-sm opacity-70">
                                            {site.presetId ||
                                                t('workspace.emptySite')}{' '}
                                            · {site.status}
                                        </p>
                                        <code class="block break-all text-xs opacity-60">
                                            {site._id}
                                        </code>
                                        <Button
                                            class="mt-3"
                                            disabled={busy.value}
                                            onClick={() =>
                                                run(() =>
                                                    sdk.selectContext({
                                                        workspaceId:
                                                            sdk.context!.context
                                                                .workspaceId,
                                                        siteId: site._id,
                                                    }, site.status === 'empty' ? siteSetupHref : '/d/studio?section=overview'),
                                                )
                                            }
                                        >
                                            {sdk.context?.context.siteId ===
                                            site._id
                                                ? site.status === 'empty' ? '继续创建网站' : t('workspace.currentSite')
                                                : site.status === 'empty' ? '设置网站' : t('workspace.openSite')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            {admin() && <RouterLink class="mt-4 inline-flex min-h-[44px] items-center text-sm underline" to={`${siteSetupHref}?new=1`}>使用向导创建网站 →</RouterLink>}
                            {admin() && (
                                <form
                                    class="mt-5 flex flex-wrap gap-3"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        run(async () => {
                                            const site =
                                                await sdk.send<SiteInstallation>(
                                                    {
                                                        url: '/api/v4/workspaces/current/sites',
                                                        method: 'POST',
                                                        data: {
                                                            name: siteName.value.trim(),
                                                        },
                                                    },
                                                );
                                            await sdk.selectContext({
                                                workspaceId:
                                                    sdk.context!.context
                                                        .workspaceId,
                                                siteId: site._id,
                                            });
                                        });
                                    }}
                                >
                                    <input
                                        class={formClass}
                                        aria-label={t('workspace.siteName')}
                                        placeholder={t('workspace.siteName')}
                                        value={siteName.value}
                                        required
                                        maxlength={80}
                                        onInput={(event) => {
                                            siteName.value = (
                                                event.target as HTMLInputElement
                                            ).value;
                                        }}
                                    />
                                    <Button
                                        type="submit"
                                        disabled={
                                            busy.value || !siteName.value.trim()
                                        }
                                    >
                                        {t('workspace.createSite')}
                                    </Button>
                                </form>
                            )}
                        </section>
                        {admin() && (
                            <section class={panelClass}>
                                <h2 class="font-semibold">
                                    {t('workspace.manage')}
                                </h2>
                                <form
                                    class="mt-4 flex flex-wrap gap-3"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        run(() =>
                                            sdk.send({
                                                url: '/api/v4/workspaces/current',
                                                method: 'PUT',
                                                data: {
                                                    name: rename.value.trim(),
                                                },
                                            }),
                                        );
                                    }}
                                >
                                    <input
                                        class={formClass}
                                        aria-label={t('workspace.name')}
                                        value={rename.value}
                                        required
                                        maxlength={80}
                                        onInput={(event) => {
                                            rename.value = (
                                                event.target as HTMLInputElement
                                            ).value;
                                        }}
                                    />
                                    <Button type="submit" disabled={busy.value}>
                                        {t('common.update')}
                                    </Button>
                                </form>
                                <h3 id="workspace-members" class="mt-6 font-semibold">
                                    {t('workspace.members')}
                                </h3>
                                <p class="mt-2 text-sm opacity-70">
                                    {t('workspace.memberHint')}
                                </p>
                                <ul class="mt-3">
                                    {current.value?.members.map((member) => (
                                        <li class="flex flex-wrap items-center gap-3 border-b border-gray/40 py-3">
                                            <code class="break-all text-sm">
                                                {member.userId}
                                            </code>
                                            <span>
                                                {t(
                                                    `workspace.roles.${member.role}`,
                                                )}
                                            </span>
                                            <Button
                                                disabled={busy.value}
                                                onClick={() =>
                                                    removeMember(member.userId)
                                                }
                                            >
                                                {t('workspace.removeMember')}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                                <form
                                    class="mt-4 flex flex-wrap gap-3"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        run(() =>
                                            sdk.send({
                                                url: `/api/v4/workspaces/current/members/${encodeURIComponent(
                                                    memberId.value.trim(),
                                                )}`,
                                                method: 'PUT',
                                                data: { role: role.value },
                                            }),
                                        );
                                    }}
                                >
                                    <input
                                        class={formClass}
                                        aria-label={t('workspace.userId')}
                                        placeholder={t('workspace.userId')}
                                        value={memberId.value}
                                        required
                                        onInput={(event) => {
                                            memberId.value = (
                                                event.target as HTMLInputElement
                                            ).value;
                                        }}
                                    />
                                    <select
                                        class={formClass}
                                        aria-label={t('workspace.role')}
                                        value={role.value}
                                        onChange={(event) => {
                                            role.value = (
                                                event.target as HTMLSelectElement
                                            ).value as typeof role.value;
                                        }}
                                    >
                                        {(
                                            [
                                                'admin',
                                                'editor',
                                                'viewer',
                                            ] as const
                                        ).map((value) => (
                                            <option value={value}>
                                                {t(`workspace.roles.${value}`)}
                                            </option>
                                        ))}
                                    </select>
                                    <Button type="submit" disabled={busy.value}>
                                        {t('workspace.saveMember')}
                                    </Button>
                                </form>
                            </section>
                        )}
                    </>
                )}
            </div>
        );
    },
});
