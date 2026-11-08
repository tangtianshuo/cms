import type { SiteGatewayBinding } from './model';
import type { ProvisioningState } from '../presets/site-model';
import { runWithWorkspace } from '../workspaces/context';
import {
    validateConfig,
    validateGatewayBaseUrl,
} from '../presets/gateway-client';

export interface ProvisionInput {
    cmsWorkspaceId: string;
    cmsSiteId: string;
    name: string;
    requestKey: string;
}
export type ProvisionResult = Omit<SiteGatewayBinding, 'source'>;
export type ProvisioningCode =
    | 'gateway_unavailable'
    | 'gateway_unauthorized'
    | 'binding_conflict'
    | 'configuration_missing';
export interface ProvisioningStore {
    claim(now: number): Promise<{
        cmsWorkspaceId: string;
        cmsSiteId: string;
        name: string;
        state: ProvisioningState;
    } | null>;
    complete(
        siteId: string,
        leaseToken: string,
        binding: SiteGatewayBinding,
    ): Promise<boolean>;
    defer(
        siteId: string,
        leaseToken: string,
        nextAttemptAt: number,
        code: ProvisioningCode,
    ): Promise<boolean>;
}
export class ProvisioningError extends Error {
    constructor(readonly code: ProvisioningCode) {
        super(code);
    }
}
export async function runProvisioningTick(
    store: ProvisioningStore,
    provision: (input: ProvisionInput) => Promise<ProvisionResult>,
    now: number,
): Promise<void> {
    const item = await store.claim(now);
    if (!item) return;
    const token = item.state.leaseToken;
    if (!token) throw new Error('Provisioning claim has no lease');
    try {
        const result = await provision({
            cmsWorkspaceId: item.cmsWorkspaceId,
            cmsSiteId: item.cmsSiteId,
            name: item.name,
            requestKey: item.state.requestKey,
        });
        if (
            result.cmsWorkspaceId !== item.cmsWorkspaceId ||
            result.cmsSiteId !== item.cmsSiteId
        )
            throw new ProvisioningError('binding_conflict');
        await store.complete(item.cmsSiteId, token, {
            ...result,
            source: 'provisioned',
        });
    } catch (cause) {
        const code =
            cause instanceof ProvisioningError
                ? cause.code
                : 'gateway_unavailable';
        const delays = [5000, 15000, 60000, 300000];
        await store.defer(
            item.cmsSiteId,
            token,
            now + delays[Math.min(Math.max(item.state.attempts - 1, 0), 3)],
            code,
        );
    }
}

/** The bounded HTTP client never returns upstream diagnostics or credentials. */
export function createProvisioner(
    env: NodeJS.ProcessEnv = process.env,
    fetcher: typeof fetch = fetch,
) {
    return async (input: ProvisionInput): Promise<ProvisionResult> => {
        const gatewayBaseUrl = env.GATEWAY_BASE_URL || '';
        const serviceSecret = env.CMS_SERVICE_SECRET || '';
        let base: URL;
        try {
            base = validateGatewayBaseUrl(gatewayBaseUrl);
            if (!serviceSecret.trim()) throw new Error();
        } catch {
            throw new ProvisioningError('configuration_missing');
        }
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                controller.abort();
                reject(new ProvisioningError('gateway_unavailable'));
            }, 15000);
        });
        try {
            const operation = async (): Promise<ProvisionResult> => {
                const response = await fetcher(
                    `${base.origin}/api/v1/site-provisioning`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${serviceSecret}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(input),
                        signal: controller.signal,
                        redirect: 'error',
                    },
                );
                if (response.status === 401 || response.status === 403)
                    throw new ProvisioningError('gateway_unauthorized');
                if (response.status === 409 || response.status === 400)
                    throw new ProvisioningError('binding_conflict');
                if (!response.ok)
                    throw new ProvisioningError('gateway_unavailable');
                const body = (await response.json()) as ProvisionResult;
                try {
                    if (
                        !body ||
                        body.cmsWorkspaceId !== input.cmsWorkspaceId ||
                        body.cmsSiteId !== input.cmsSiteId
                    )
                        throw new Error();
                    validateConfig({ ...body, gatewayBaseUrl, serviceSecret });
                } catch {
                    throw new ProvisioningError('binding_conflict');
                }
                return {
                    cmsWorkspaceId: body.cmsWorkspaceId,
                    cmsSiteId: body.cmsSiteId,
                    workspaceId: body.workspaceId,
                    siteId: body.siteId,
                    siteUrl: body.siteUrl,
                };
            };
            return await Promise.race([operation(), deadline]);
        } catch (cause) {
            if (cause instanceof ProvisioningError) throw cause;
            throw new ProvisioningError('gateway_unavailable');
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    };
}

/** Only persisted claimed ownership establishes background selected-site authority. */
export function createProvisioningStore(): ProvisioningStore {
    return {
        async claim(now) {
            const { Repo } = await import('../repo');
            return Repo.siteInstallation.methods.claimProvisioning(now);
        },
        async complete(siteId, token, binding) {
            const { Repo } = await import('../repo');
            const site = await Repo.siteInstallation.methods.findFresh(siteId);
            if (
                !site ||
                site.provisioning?.status !== 'running' ||
                site.provisioning.leaseToken !== token ||
                (site.provisioning.leaseUntil || 0) <= Date.now()
            )
                return false;
            const cmsWorkspaceId = site.workspaceId || 'default';
            if (
                binding.cmsWorkspaceId !== cmsWorkspaceId ||
                binding.cmsSiteId !== site._id
            )
                throw new ProvisioningError('binding_conflict');
            await runWithWorkspace(
                {
                    workspaceId: cmsWorkspaceId,
                    siteId: site._id,
                    actorId: '__site-provisioning',
                    admin: true,
                    instanceAdmin: true,
                    role: 'admin',
                },
                async () => {
                    try {
                        await Repo.siteGatewayBinding.methods.persist(binding);
                    } catch (cause) {
                        if (
                            cause instanceof Error &&
                            cause.message === 'Gateway binding conflict'
                        )
                            throw new ProvisioningError('binding_conflict');
                        throw cause;
                    }
                },
            );
            return Repo.siteInstallation.methods.completeProvisioning(
                siteId,
                token,
            );
        },
        async defer(siteId, token, nextAttemptAt, code) {
            const { Repo } = await import('../repo');
            return Repo.siteInstallation.methods.deferProvisioning(
                siteId,
                token,
                nextAttemptAt,
                code,
            );
        },
    };
}
