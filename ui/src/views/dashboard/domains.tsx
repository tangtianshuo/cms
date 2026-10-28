import { defineComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SiteDomain } from '@bcms/selfhosted-backend/site-domains/model';
import { Button } from '@bcms/selfhosted-ui/components/button';
import {
    errorMessage,
    formClass,
    panelClass,
} from '@bcms/selfhosted-ui/components/workspace/common';
type Domain = Omit<SiteDomain, 'verificationTokenHash'> & {
    isPrimary: boolean;
};
interface DomainList {
    items: Domain[];
    primaryDomainId?: string;
    bindingRevision: number;
    guidance: {
        entryHost: string;
        entryIp: string;
        txtPrefix: string;
        challengePath: string;
    };
}
interface Verification {
    txtName: string;
    txtValue: string;
    expiresAt: number;
}

export default defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const data = ref<DomainList>();
        const hostname = ref('');
        const secret = ref<Verification>();
        const error = ref('');
        const busy = ref(false);
        const copied = ref(false);
        const selectedSite = !!sdk.context?.context.siteId;
        const admin = !!sdk.context?.context.admin && selectedSite;
        async function refresh() {
            data.value = await sdk.send<DomainList>({
                url: '/api/v4/site-domains',
            });
        }
        async function run(operation: () => Promise<unknown>) {
            if (busy.value) return;
            busy.value = true;
            error.value = '';
            try {
                await operation();
            } catch (cause) {
                const value = cause as { status?: number };
                error.value = `${errorMessage(cause)}${
                    value.status === 409
                        ? ` ${t('domains.conflict')}`
                        : value.status === 429
                        ? ` ${t('domains.throttled')}`
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
        async function copy(value: string) {
            try {
                await navigator.clipboard.writeText(value);
                copied.value = true;
            } catch (cause) {
                error.value = errorMessage(cause);
            }
        }
        function action(id: string, operation: string, body?: unknown) {
            return run(() =>
                sdk.send({
                    url: `/api/v4/site-domains/${encodeURIComponent(
                        id,
                    )}/${operation}`,
                    method: 'POST',
                    data: body,
                }),
            );
        }
        onMounted(() => {
            if (admin) run(async () => undefined);
        });
        return () => (
            <div class="max-w-5xl">
                <h1 class="text-2xl font-semibold">{t('workspace.domains')}</h1>
                <p class="mt-2 text-sm opacity-70">{t('domains.scopeHint')}</p>
                {!selectedSite && (
                    <a class="mt-4 block underline" href="/d/workspaces">
                        {t('workspace.chooseSite')}
                    </a>
                )}
                {!sdk.context?.context.admin && (
                    <p class="mt-5">{t('workspace.adminRequired')}</p>
                )}
                {error.value && (
                    <p
                        role="alert"
                        class="mt-4 border-l-4 border-red bg-error p-3 text-sm leading-relaxed text-dark"
                    >
                        {error.value}
                    </p>
                )}
                {admin && (
                    <>
                        <form
                            class={`${panelClass} flex flex-wrap items-end gap-3`}
                            onSubmit={(event) => {
                                event.preventDefault();
                                run(async () => {
                                    secret.value = undefined;
                                    copied.value = false;
                                    secret.value = await sdk.send<Verification>(
                                        {
                                            url: '/api/v4/site-domains',
                                            method: 'POST',
                                            data: {
                                                hostname: hostname.value.trim(),
                                            },
                                        },
                                    );
                                    hostname.value = '';
                                });
                            }}
                        >
                            <label class="flex-1 text-sm">
                                {t('domains.hostname')}
                                <input
                                    class={`${formClass} mt-2 block w-full`}
                                    placeholder="shop.example.com"
                                    value={hostname.value}
                                    required
                                    onInput={(event) => {
                                        hostname.value = (
                                            event.target as HTMLInputElement
                                        ).value;
                                    }}
                                />
                            </label>
                            <Button
                                type="submit"
                                disabled={busy.value || !hostname.value.trim()}
                            >
                                {t('domains.add')}
                            </Button>
                        </form>
                        {secret.value && (
                            <section
                                class={panelClass}
                                aria-label={t('domains.verification')}
                            >
                                <h2 class="font-semibold">
                                    {t('domains.oneTime')}
                                </h2>
                                <p class="mt-2 text-sm">
                                    {t('domains.expiry', {
                                        at: new Date(
                                            secret.value.expiresAt,
                                        ).toLocaleString(),
                                    })}
                                </p>
                                <dl class="mt-3 space-y-2 text-sm">
                                    <dt>{t('domains.txtName')}</dt>
                                    <dd class="break-all font-mono">
                                        {secret.value.txtName}
                                    </dd>
                                    <dt>{t('domains.txtValue')}</dt>
                                    <dd class="break-all font-mono">
                                        {secret.value.txtValue}
                                    </dd>
                                </dl>
                                <Button
                                    class="mt-4"
                                    onClick={() =>
                                        copy(
                                            `${secret.value!.txtName} TXT ${
                                                secret.value!.txtValue
                                            }`,
                                        )
                                    }
                                >
                                    {copied.value
                                        ? t('domains.copied')
                                        : t('domains.copyTxt')}
                                </Button>
                                <Button
                                    class="ml-3 mt-4"
                                    onClick={() => {
                                        secret.value = undefined;
                                    }}
                                >
                                    {t('common.close')}
                                </Button>
                            </section>
                        )}
                        {data.value && (
                            <section class={panelClass}>
                                <h2 class="font-semibold">
                                    {t('domains.instructions')}
                                </h2>
                                <p class="mt-2 text-sm">
                                    {t('domains.dnsHint')}
                                </p>
                                <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                                    <div>
                                        <dt>CNAME</dt>
                                        <dd class="break-all font-mono">
                                            {data.value.guidance.entryHost ||
                                                t('domains.operatorRequired')}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>A</dt>
                                        <dd class="break-all font-mono">
                                            {data.value.guidance.entryIp ||
                                                t('domains.operatorRequired')}
                                        </dd>
                                    </div>
                                    <div class="sm:col-span-2">
                                        <dt>{t('domains.challenge')}</dt>
                                        <dd class="break-all font-mono">
                                            {data.value.guidance.challengePath}
                                        </dd>
                                    </div>
                                </dl>
                                <p class="mt-3 text-sm opacity-70">
                                    {t('domains.tlsHint')}
                                </p>
                                <Button
                                    class="mt-4"
                                    onClick={() =>
                                        copy(
                                            `CNAME ${
                                                data.value!.guidance.entryHost
                                            }\nA ${
                                                data.value!.guidance.entryIp
                                            }\nHTTPS ${
                                                data.value!.guidance
                                                    .challengePath
                                            }`,
                                        )
                                    }
                                >
                                    {t('domains.copyConfig')}
                                </Button>
                            </section>
                        )}
                        <div class="mt-6 flex items-center justify-between gap-3">
                            <h2 class="font-semibold">
                                {t('domains.bindings')}
                            </h2>
                            <Button
                                disabled={busy.value}
                                onClick={() => run(async () => undefined)}
                            >
                                {t('workspace.refresh')}
                            </Button>
                        </div>
                        {data.value?.items.map((item) => (
                            <article class={panelClass} key={item._id}>
                                <div class="flex flex-wrap items-center gap-3">
                                    <h3 class="text-lg font-semibold break-all">
                                        {item.hostname}
                                    </h3>
                                    {item.isPrimary && (
                                        <strong class="text-green dark:text-yellow">
                                            {t('domains.primary')}
                                        </strong>
                                    )}
                                </div>
                                <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                                    <div>
                                        <dt>{t('domains.ownership')}</dt>
                                        <dd>
                                            {t(
                                                `domains.ownershipStates.${item.ownershipStatus}`,
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>{t('domains.connection')}</dt>
                                        <dd>
                                            {t(
                                                `domains.connectionStates.${item.connectionStatus}`,
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>{t('domains.state')}</dt>
                                        <dd>
                                            {t(
                                                item.enabled
                                                    ? 'domains.enabled'
                                                    : 'domains.disabled',
                                            )}
                                        </dd>
                                    </div>
                                </dl>
                                {!!item.lastCheckedAt && (
                                    <p class="mt-2 text-xs opacity-70">
                                        {t('domains.checkedAt', {
                                            at: new Date(
                                                item.lastCheckedAt,
                                            ).toLocaleString(),
                                        })}
                                    </p>
                                )}
                                {!!item.lastSuccessAt && (
                                    <p class="mt-2 text-xs opacity-70">
                                        {t('domains.successAt', {
                                            at: new Date(
                                                item.lastSuccessAt,
                                            ).toLocaleString(),
                                        })}
                                    </p>
                                )}
                                {item.lastError && (
                                    <p class="mt-3 text-sm text-red">
                                        {errorMessage(item.lastError)}
                                    </p>
                                )}
                                <div class="mt-4 flex flex-wrap gap-3">
                                    <Button
                                        disabled={busy.value}
                                        onClick={() =>
                                            action(item._id, 'check')
                                        }
                                    >
                                        {t('domains.check')}
                                    </Button>
                                    <Button
                                        disabled={
                                            busy.value ||
                                            item.isPrimary ||
                                            !item.enabled ||
                                            item.ownershipStatus !==
                                                'verified' ||
                                            !item.lastSuccessAt
                                        }
                                        onClick={() =>
                                            action(item._id, 'primary')
                                        }
                                    >
                                        {t('domains.makePrimary')}
                                    </Button>
                                    <Button
                                        disabled={busy.value}
                                        onClick={() =>
                                            action(item._id, 'state', {
                                                enabled: !item.enabled,
                                            })
                                        }
                                    >
                                        {t(
                                            item.enabled
                                                ? 'domains.disable'
                                                : 'domains.enable',
                                        )}
                                    </Button>
                                    <Button
                                        disabled={busy.value}
                                        kind="danger"
                                        onClick={async () => {
                                            if (
                                                await window.bcms.confirm(
                                                    t('domains.unbind'),
                                                    t('domains.unbindConfirm', {
                                                        hostname: item.hostname,
                                                    }),
                                                )
                                            )
                                                await run(() =>
                                                    sdk.send({
                                                        url: `/api/v4/site-domains/${encodeURIComponent(
                                                            item._id,
                                                        )}`,
                                                        method: 'DELETE',
                                                    }),
                                                );
                                        }}
                                    >
                                        {t('domains.unbind')}
                                    </Button>
                                    {item.enabled &&
                                        item.ownershipStatus === 'verified' &&
                                        !!item.lastSuccessAt && (
                                            <a
                                                class="underline text-sm self-center"
                                                href={`https://${item.hostname}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {t('domains.open')}
                                            </a>
                                        )}
                                </div>
                                {item.isPrimary && (
                                    <p class="mt-3 text-sm opacity-70">
                                        {t('domains.primaryHint')}
                                    </p>
                                )}
                            </article>
                        ))}
                    </>
                )}
            </div>
        );
    },
});
