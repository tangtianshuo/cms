import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { PresetController } from './controller';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import { verifiedWorkspace } from '../workspaces/context';

test(
    'legacy migration HTTP plan returns safe structured issues from the real controller',
    { skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 60_000 },
    async (context) => {
        const app = Fastify();
        app.setErrorHandler((error, _request, reply) => {
            const controlled = error as {
                status?: number;
                message?: unknown;
            };
            if (
                controlled.status &&
                controlled.message &&
                typeof controlled.message === 'object'
            )
                return reply.code(controlled.status).send(controlled.message);
            return reply
                .code(controlled.status || 500)
                .send({ message: error.message });
        });
        await app.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_plan_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        context.after(async () => {
            await app.mongo.db?.dropDatabase();
            await app.close();
        });
        await new Promise<void>((resolve, reject) =>
            Repo.siteInstallation.init().initialize({
                fastify: app,
                next: (error?: Error) => (error ? reject(error) : resolve()),
            } as never),
        );
        const siteId = randomUUID();
        await Repo.siteInstallation.add(
            {
                _id: siteId,
                workspaceId: 'default',
                slot: 'default',
                createdAt: 1,
                updatedAt: 1,
                name: 'Incompatible legacy site',
                presetId: 'atelier',
                presetVersion: '1.0.0',
                status: 'ready',
                importError: '',
                includeDemo: false,
                demoSeeded: false,
                models: [],
                pages: [],
                theme: {
                    background: '#ffffff',
                    foreground: '#111111',
                    accent: '#0066cc',
                    muted: '#eeeeee',
                    font: 'Arial',
                },
                presetManifestSnapshot: JSON.stringify({
                    id: 'different-template',
                    version: '9.9.9',
                    models: [],
                    pages: [],
                }),
            } as never,
            true,
        );

        const mutableProtection = RP as unknown as Record<string, unknown>;
        const originalProtection = mutableProtection.createWorkspaceAdminCheck;
        mutableProtection.createWorkspaceAdminCheck = () => async () => ({
            token: { payload: { userId: 'admin' } },
            [verifiedWorkspace]: {
                workspaceId: 'default',
                actorId: 'admin',
                admin: true,
                instanceAdmin: true,
                role: 'admin',
            },
        });
        try {
            const controller = await PresetController({
                config: {},
                fastify: app,
            } as never);
            const method = (await controller.methods(controller)).find(
                (item) => item.name === 'legacyMigrationPlan',
            );
            assert.ok(method);
            app.route({
                method: method.type.toUpperCase() as 'POST',
                url: `/api/v4/presets${method.path}`,
                handler: method.handler,
            });
            const response = await app.inject({
                method: 'POST',
                url: '/api/v4/presets/migrations/legacy/plan',
                payload: {
                    siteId,
                    requestKey: randomUUID(),
                },
            });
            assert.equal(response.statusCode, 422);
            assert.deepEqual(JSON.parse(response.body).issues, [
                {
                    code: 'template_snapshot_incompatible',
                    path: 'template',
                },
            ]);
            assert.equal(response.body.includes('/Users/'), false);
        } finally {
            mutableProtection.createWorkspaceAdminCheck = originalProtection;
        }
    },
);
