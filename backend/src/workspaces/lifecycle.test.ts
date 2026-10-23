import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { Config } from '../config';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { WorkspaceController } from './controller';

function barrier() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function fixture(context: { after(action: () => Promise<void>): void }) {
    const app = Fastify();
    const database = `cms_workspace_lifecycle_${randomUUID().replaceAll(
        '-',
        '',
    )}`;
    await app.register(fastifyMongo, {
        url: process.env.STOREFRONT_TEST_MONGO!,
        database,
        forceClose: true,
    });
    context.after(async () => {
        await app.mongo.db?.dropDatabase();
        await app.close();
    });
    for (const repo of [
        Repo.workspace,
        Repo.siteInstallation,
        Repo.template,
        Repo.entry,
        Repo.media,
        Repo.widget,
        Repo.group,
        Repo.language,
        Repo.entryStatus,
        Repo.templateOrganizer,
        Repo.apiKey,
    ]) {
        await new Promise<void>((resolve, reject) =>
            repo.init().initialize({
                fastify: app,
                next: (error?: Error) => (error ? reject(error) : resolve()),
            } as never),
        );
    }
    JWTManager.setScopes([
        {
            issuer: Config.jwtIssuer,
            secret: Config.jwtSecret,
            alg: 'HS256',
            expIn: 60000,
        },
    ]);
    const token = JWTManager.create({
        issuer: Config.jwtIssuer,
        userId: 'admin',
        roles: ['ADMIN'],
    });
    assert.ok(!(token instanceof JWTError));
    const authorization = `Bearer ${JWTEncode.encode(token)}`;
    app.setErrorHandler((error, _req, reply) =>
        reply
            .code((error as unknown as { status?: number }).status || 500)
            .send({ message: error.message }),
    );
    const controller = await WorkspaceController({} as never);
    for (const method of await controller.methods(controller)) {
        app.route({
            method: method.type.toUpperCase() as 'GET' | 'POST' | 'DELETE',
            url: `${controller.path}${method.path}`,
            handler: method.handler,
        });
    }
    const workspace = await Repo.workspace.add({
        _id: randomUUID(),
        name: 'Race',
        members: [],
        createdAt: 1,
        updatedAt: 1,
    });
    const headers = { authorization, 'x-bcms-workspace': workspace._id };
    return {
        app,
        workspace,
        create: () =>
            app.inject({
                method: 'POST',
                url: '/api/v4/workspaces/current/sites',
                headers,
                payload: { name: 'New site' },
            }),
        remove: () =>
            app.inject({
                method: 'DELETE',
                url: '/api/v4/workspaces/current',
                headers,
            }),
    };
}
const options = { skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 10000 };

test(
    'a site creation reserved before insert prevents concurrent workspace deletion',
    options,
    async (context) => {
        const { workspace, create, remove } = await fixture(context);
        const reached = barrier();
        const resume = barrier();
        const add = Repo.siteInstallation.add;
        Repo.siteInstallation.add = async (...args) => {
            reached.resolve();
            await resume.promise;
            return add.apply(Repo.siteInstallation, args);
        };
        const pending = create();
        try {
            await reached.promise;
            const deletion = await remove();
            assert.equal(deletion.statusCode, 409, deletion.body);
            assert.ok(await Repo.workspace.methods.fresh(workspace._id));
        } finally {
            resume.resolve();
            const creation = await pending;
            Repo.siteInstallation.add = add;
            assert.equal(creation.statusCode, 200, creation.body);
        }
        assert.equal(
            (await Repo.siteInstallation.methods.listWorkspace(workspace._id))
                .length,
            1,
        );
    },
);

test(
    'deletion winning before a previously authorized creator reserves leaves no orphan',
    options,
    async (context) => {
        const { workspace, create, remove } = await fixture(context);
        const reached = barrier();
        const resume = barrier();
        const fresh = Repo.workspace.methods.fresh;
        let first = true;
        Repo.workspace.methods.fresh = async (id) => {
            const value = await fresh(id);
            if (id === workspace._id && first) {
                first = false;
                reached.resolve();
                await resume.promise;
            }
            return value;
        };
        const pending = create();
        try {
            await reached.promise;
            const deletion = await remove();
            assert.equal(deletion.statusCode, 200, deletion.body);
        } finally {
            resume.resolve();
            const creation = await pending;
            Repo.workspace.methods.fresh = fresh;
            assert.equal(creation.statusCode, 409, creation.body);
        }
        assert.equal(
            (await Repo.siteInstallation.methods.listWorkspace(workspace._id))
                .length,
            0,
        );
    },
);

test(
    'a creation completed after the empty-site check invalidates deletion revision',
    options,
    async (context) => {
        const { workspace, create, remove } = await fixture(context);
        const reached = barrier();
        const resume = barrier();
        const list = Repo.siteInstallation.methods.listWorkspace;
        Repo.siteInstallation.methods.listWorkspace = async (id) => {
            const items = await list(id);
            reached.resolve();
            await resume.promise;
            return items;
        };
        const pending = remove();
        try {
            await reached.promise;
            const creation = await create();
            assert.equal(creation.statusCode, 200, creation.body);
        } finally {
            resume.resolve();
            const deletion = await pending;
            Repo.siteInstallation.methods.listWorkspace = list;
            assert.equal(deletion.statusCode, 409, deletion.body);
        }
        assert.ok(await Repo.workspace.methods.fresh(workspace._id));
        assert.equal(
            (await Repo.siteInstallation.methods.listWorkspace(workspace._id))
                .length,
            1,
        );
    },
);

test(
    'interrupted creation reservations survive age and restart until explicitly recovered',
    options,
    async (context) => {
        const { app, workspace, create, remove } = await fixture(context);
        const add = Repo.siteInstallation.add;
        Repo.siteInstallation.add = async () => {
            throw new Error('simulated interrupted persistence');
        };
        try {
            assert.equal((await create()).statusCode, 500);
        } finally {
            Repo.siteInstallation.add = add;
        }
        const pending = (await Repo.workspace.methods.fresh(workspace._id))
            ?.pendingCreations;
        assert.equal(pending?.length, 1);
        assert.equal(pending?.[0].kind, 'site');
        await app.mongo.db!.collection(Repo.workspace.collection).updateOne(
            { _id: workspace._id as never },
            {
                $set: { 'pendingCreations.0.createdAt': 1 },
            },
        );
        await new Promise<void>((resolve, reject) =>
            Repo.workspace
                .init()
                .initialize({
                    fastify: app,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
        );
        assert.equal((await remove()).statusCode, 409);
        // This test's writer has exited without submitting any insert. In production
        // recovery must also prove that no issued database/storage write can commit.
        await Repo.workspace.methods.completeCreation(
            workspace._id,
            pending![0].id,
        );
        await Repo.workspace.methods.completeCreation(
            workspace._id,
            pending![0].id,
        );
        assert.equal((await remove()).statusCode, 200);
    },
);
