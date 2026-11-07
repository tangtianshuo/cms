import type { Module } from '../_server';
import { Config } from '../config';
import { runWithWorkspace } from '../workspaces/context';
import type { GatewayPublishConfig } from './gateway-client';
import { resolveGatewayPublishConfigs } from '../site-provisioning/config';
import { gatewayBound } from './gateway-publish';
import { recoverGatewayPublication } from './gateway-recovery';
import { releaseSource } from './release-source';
import { Repo } from '../repo';
import { reconcileMigration } from '../template-contract/migration-service';

type RecoveryAction = (config: GatewayPublishConfig) => Promise<void>;
type RecoveryErrorHandler = (cause: unknown) => void;

export function withGatewayRecoveryWorkspace<T>(
    config: GatewayPublishConfig,
    action: () => Promise<T>,
) {
    return runWithWorkspace(
        {
            workspaceId: config.cmsWorkspaceId,
            siteId: config.cmsSiteId,
            actorId: '__gateway-recovery',
            admin: true,
            instanceAdmin: true,
            role: 'admin',
        },
        action,
    );
}

async function recoverBinding(config: GatewayPublishConfig) {
    const source = releaseSource();
    if (gatewayBound(await source.findSite(), config))
        await recoverGatewayPublication(source, config);
}

function reportRecoveryFailure(cause: unknown) {
    console.error(
        'Gateway publication recovery deferred',
        cause instanceof Error ? cause.message : 'Unknown error',
    );
}

export async function runGatewayRecoveryTick(
    loadConfigs: () => Promise<
        GatewayPublishConfig[]
    > = resolveGatewayPublishConfigs,
    recover: RecoveryAction = recoverBinding,
    report: RecoveryErrorHandler = reportRecoveryFailure,
) {
    let configs: GatewayPublishConfig[];
    try {
        configs = await loadConfigs();
    } catch (cause) {
        report(cause);
        return;
    }
    for (const config of configs) {
        try {
            await withGatewayRecoveryWorkspace(config, () => recover(config));
        } catch (cause) {
            report(cause);
        }
    }
}

export async function runMigrationRecoveryTick(
    list: () => Promise<
        Array<{
            id: string;
            cmsWorkspaceId: string;
            cmsSiteId: string;
            status?: string;
            recoveryPhase?: string;
        }>
    > = async () => {
        const [publishing, active] = await Promise.all([
            Repo.migrationOperation.listByStatus('publishing'),
            Repo.migrationOperation.listByStatus('active'),
        ]);
        return [...publishing, ...active].filter(
            (operation) =>
                operation.status === 'publishing' ||
                operation.recoveryPhase === 'rollback-requested' ||
                operation.recoveryPhase === 'gateway-rolled-back',
        );
    },
    reconcile: (id: string) => Promise<unknown> = reconcileMigration,
    report: RecoveryErrorHandler = reportRecoveryFailure,
) {
    let operations;
    try {
        operations = await list();
    } catch (cause) {
        report(cause);
        return;
    }
    for (const operation of operations) {
        try {
            await runWithWorkspace(
                {
                    workspaceId: operation.cmsWorkspaceId,
                    siteId: operation.cmsSiteId,
                    actorId: '__migration-recovery',
                    admin: true,
                    instanceAdmin: true,
                    role: 'admin',
                },
                () => reconcile(operation.id),
            );
        } catch (cause) {
            report(cause);
        }
    }
}

export function createGatewayReconciliationJob(): Module {
    return {
        name: 'Gateway publication recovery',
        initialize({ fastify, next }) {
            let running = false;
            let stopped = false;
            async function tick() {
                if (running || stopped || !Config.storefrontEnabled) return;
                running = true;
                try {
                    await runGatewayRecoveryTick();
                    await runMigrationRecoveryTick();
                } finally {
                    running = false;
                }
            }
            const timer = setInterval(() => {
                void tick();
            }, 15000);
            timer.unref();
            fastify.addHook('onClose', async () => {
                stopped = true;
                clearInterval(timer);
            });
            next();
        },
    };
}
