import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { runWithWorkspace } from '../workspaces/context';
import type { SiteInstallation } from '../presets/site-model';
import {
    initMigrationRepository,
    mongoMigrationRepository,
    type MigrationOperation,
} from './migration-repo';
import {
    setSiteMutationStore,
    SiteMutationConflict,
    withSiteMutation,
} from './site-mutation';

test(
    'real Mongo persists migration operations and enforces publishing write blocking',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 60_000,
    },
    async (context) => {
        const app = Fastify();
        await app.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        context.after(async () => {
            await app.mongo.db?.dropDatabase();
            await app.close();
        });
        for (const repo of [
            Repo.siteInstallation,
        ]) {
            await new Promise<void>((resolve, reject) =>
                repo.init().initialize({
                    fastify: app,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
            );
        }
        await initMigrationRepository(app);
        setSiteMutationStore(Repo.siteInstallation.methods);
        const siteId = randomUUID();
        const site: SiteInstallation = {
            _id: siteId,
            workspaceId: 'default',
            slot: 'default',
            createdAt: 1,
            updatedAt: 1,
            name: 'Migration integration',
            presetId: 'service-studio',
            presetVersion: '1.0.0',
            status: 'ready',
            importError: '',
            includeDemo: false,
            demoSeeded: false,
            theme: {
                background: '#ffffff',
                foreground: '#111111',
                accent: '#0066cc',
                muted: '#eeeeee',
                font: 'Arial',
            },
            models: [],
            pages: [],
        };
        await runWithWorkspace(
            {
                workspaceId: 'default',
                actorId: 'migration-test',
                admin: true,
                instanceAdmin: true,
                role: 'admin',
            },
            () => Repo.siteInstallation.add(site),
        );
        await withSiteMutation(
            siteId,
            async () => {
                assert.equal(
                    (
                        await Repo.siteInstallation.methods.siteMutationState(
                            siteId,
                        )
                    ).status,
                    'publishing',
                );
            },
            { mode: 'migration', operationId: 'operation-1' },
        );
        await assert.rejects(
            () =>
                withSiteMutation(siteId, async () => undefined),
            SiteMutationConflict,
        );
        const candidate: SiteInstallation = {
            ...site,
            presetVersion: '1.0.1',
            updatedAt: 2,
        };
        const operation: MigrationOperation = {
            id: randomUUID(),
            cmsWorkspaceId: 'default',
            cmsSiteId: siteId,
            requestKey: randomUUID(),
            expectedUpdatedAt: 1,
            sourceChecksum: `sha256:${'a'.repeat(64)}`,
            targetManifestChecksum: `sha256:${'b'.repeat(64)}`,
            status: 'staged',
            previousSite: site,
            candidateSite: candidate,
            previousReleaseId: 'release-1',
            createdAt: 1,
            updatedAt: 1,
        };
        const first = mongoMigrationRepository();
        await first.save(operation);
        const reloaded = await mongoMigrationRepository().findByRequestKey(
            'default',
            siteId,
            operation.requestKey,
        );
        assert.ok(reloaded);
        assert.equal(reloaded?.id, operation.id);
        assert.equal(reloaded?.candidateSite.presetVersion, '1.0.1');
        assert.equal(
            await Repo.siteInstallation.methods.finalizeMigration(
                siteId,
                'operation-1',
                site.updatedAt,
                candidate,
            ),
            true,
        );
        assert.equal(
            (
                await Repo.siteInstallation.methods.siteMutationState(
                    siteId,
                )
            ).status,
            'active',
        );
        await withSiteMutation(siteId, async () => undefined);
    },
);
