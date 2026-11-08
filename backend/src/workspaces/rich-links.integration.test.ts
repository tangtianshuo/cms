import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { keyValueStore } from '../key-value-store';
import { seedIdentity } from '../test-fixtures/identity';
import { Config } from '../config';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { EntryController } from '../entry/controller';
import { TemplateFactory } from '../template/factory';
import { EntryFactory } from '../entry/factory';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { PropFactory } from '../prop/factory';
import { runWithWorkspace, type WorkspaceContext } from './context';

after(() => keyValueStore.destroy());

// The real generic HTTP handlers, scoped repositories, warm cache and disposable Mongo.
test(
    'unbound generic create/update reject foreign, unreadable and forged rich links without persisting',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 60000,
    },
    async (t) => {
        const app = Fastify();
        const mongoUrl = process.env.STOREFRONT_TEST_MONGO;
        assert.ok(mongoUrl);
        await app.register(fastifyMongo, {
            url: mongoUrl,
            database: `cms_rich_links_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        const database = app.mongo.db;
        assert.ok(database);
        t.after(async () => {
            await database.dropDatabase();
            await app.close();
        });
        for (const repo of [
            Repo.workspace,
            Repo.user,
            Repo.apiKey,
            Repo.widget,
            Repo.group,
            Repo.entryStatus,
            Repo.templateOrganizer,
            Repo.siteInstallation,
            Repo.template,
            Repo.entryGroup,
            Repo.entry,
            Repo.language,
            Repo.media,
            Repo.resourceShare,
        ])
            await new Promise<void>((resolve, reject) =>
                repo.init().initialize({
                    fastify: app,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
            );
        await seedIdentity('link-admin');
        await seedIdentity('link-editor', 'USER');
        for (const id of ['own', 'foreign'])
            await Repo.workspace.add({
                _id: id,
                name: id,
                members: [{ userId: 'link-editor', role: 'editor' }],
                createdAt: 1,
                updatedAt: 1,
            } as never);
        const ownSiteId = 'own-site';
        const scope = (workspaceId: string): WorkspaceContext => ({
            workspaceId,
            actorId: 'link-admin',
            admin: true,
            instanceAdmin: true,
            role: 'admin',
        });
        const title = {
            ...PropFactory.string(),
            id: 'title',
            name: 'title',
            label: 'Title',
        };
        const slug = {
            ...PropFactory.string(),
            id: 'slug',
            name: 'slug',
            label: 'Slug',
        };
        const rich = {
            ...PropFactory.richText(),
            id: 'rich',
            name: 'rich',
            label: 'Rich',
            required: false,
        };
        const templates: Record<string, Template> = {};
        const entries: Record<string, Entry> = {};
        for (const [workspace, keys] of [
            ['own', ['source', 'target', 'hidden', 'wrong']],
            ['foreign', ['foreign']],
        ] as const)
            await runWithWorkspace(scope(workspace), async () => {
                if (workspace === 'own')
                    await Repo.siteInstallation.add({
                        _id: ownSiteId,
                        workspaceId: 'own',
                        slot: 'default',
                        createdAt: 1,
                        updatedAt: 1,
                        name: 'Own site',
                        presetId: 'rich-link-test',
                        presetVersion: '1.0.0',
                        status: 'ready',
                        importError: '',
                        includeDemo: false,
                        demoSeeded: false,
                        theme: {
                            background: '#ffffff',
                            foreground: '#111111',
                            accent: '#123456',
                            muted: '#888888',
                            font: 'Arial, sans-serif',
                        },
                        models: [],
                        pages: [],
                    } as never);
                await Repo.language.add({
                    _id: workspace + '-en',
                    code: 'en',
                    name: 'English',
                    nativeName: 'English',
                    userId: 'link-admin',
                    default: true,
                    createdAt: 1,
                    updatedAt: 1,
                });
                for (const key of keys) {
                    templates[key] = await Repo.template.add(
                        TemplateFactory.create({
                            name: key,
                            label: key,
                            desc: '',
                            singleEntry: false,
                            props: [title, slug, rich],
                        }),
                    );
                    entries[key] = await Repo.entry.add(
                        EntryFactory.create({
                            templateId: templates[key]._id,
                            userId: 'link-admin',
                            statuses: [],
                            meta: [
                                {
                                    lng: 'en',
                                    props: [
                                        { id: 'title', data: [key] },
                                        { id: 'slug', data: [key] },
                                        { id: 'rich', data: [{ nodes: [] }] },
                                    ],
                                },
                            ],
                            content: [{ lng: 'en', nodes: [], plainText: '' }],
                        }),
                    );
                }
                await Repo.media.add({
                    _id: workspace + '-media',
                    name: workspace,
                    isInRoot: true,
                    parentId: '',
                    createdAt: 1,
                    updatedAt: 1,
                } as never);
            });
        const editor = await Repo.user.findById('link-editor');
        assert.ok(editor);
        editor.customPool.policy.templates = ['source', 'target'].map(
            (key) => ({
                _id: templates[key]._id,
                get: true,
                post: true,
                put: true,
                delete: false,
            }),
        );
        editor.customPool.policy.media = {
            get: false,
            post: false,
            put: false,
            delete: false,
        };
        await Repo.user.update(editor);
        JWTManager.setScopes([
            {
                issuer: Config.jwtIssuer,
                secret: Config.jwtSecret,
                alg: 'HS256',
                expIn: 600000,
            },
        ]);
        const bearer = (id: string) => {
            const jwt = JWTManager.create({
                issuer: Config.jwtIssuer,
                userId: id,
                roles: id === 'link-admin' ? ['ADMIN', 'USER'] : ['USER'],
            });
            assert.ok(!(jwt instanceof JWTError));
            return `Bearer ${JWTEncode.encode(jwt)}`;
        };
        app.setErrorHandler((error, _request, reply) =>
            reply
                .code((error as { status?: number }).status || 500)
                .send({ message: error.message }),
        );
        const controller = await EntryController({} as never);
        for (const method of await controller.methods(controller))
            app.route({
                method: method.type.toUpperCase() as any,
                url: `${controller.path}${method.path}`,
                handler: method.handler,
            });
        const source = entries.source;
        const nodes = (href: string) => [
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: 'Internal link',
                        marks: [
                            { type: 'link', attrs: { href, target: '_self' } },
                        ],
                    },
                ],
            },
        ];
        const entryLink = (key: string, target = key) =>
            `entry:${entries[key]._id}@*_${templates[target]._id}:entry`;
        const cases = [
            ['link-admin', 'media:foreign-media@*_@*_:media'],
            ['link-admin', entryLink('foreign')],
            ['link-editor', 'media:own-media@*_@*_:media'],
            ['link-editor', entryLink('hidden')],
            ['link-admin', entryLink('target', 'wrong')],
        ];
        const collection = database.collection(Repo.entry.collection);
        for (const [actor, href] of cases)
            for (const operation of ['create', 'update']) {
                const before = await collection.findOne({
                    _id: source._id as never,
                });
                assert.ok(before);
                const count = await collection.countDocuments();
                assert.ok(before);
                const meta = structuredClone(source.meta[0]);
                meta.props[2].data = [{ nodes: nodes(href) }] as never;
                const payload =
                    operation === 'create'
                        ? {
                              statuses: [],
                              meta: [
                                  {
                                      ...meta,
                                      props: meta.props.map((prop, index) =>
                                          index < 2
                                              ? {
                                                    ...prop,
                                                    data: [randomUUID()],
                                                }
                                              : prop,
                                      ),
                                  },
                              ],
                              content: [{ lng: 'en', nodes: [] }],
                          }
                        : {
                              _id: source._id,
                              expectedUpdatedAt: before.updatedAt,
                              lng: 'en',
                              meta,
                              content: { nodes: nodes(href) },
                          };
                const response = await app.inject({
                    method: operation === 'create' ? 'POST' : 'PUT',
                    url: `/api/v4/template/${source.templateId}/entry/${operation}`,
                    headers: {
                        authorization: bearer(actor),
                        'x-bcms-workspace': 'own',
                        'x-bcms-site': ownSiteId,
                    },
                    payload,
                });
                assert.equal(response.statusCode, 403, response.body);
                assert.equal(await collection.countDocuments(), count);
                assert.deepEqual(
                    await collection.findOne({ _id: source._id as never }),
                    before,
                );
            }
        for (const [actor, href] of [
            ['link-admin', 'media:own-media@*_@*_:media'],
            ['link-editor', entryLink('target')],
        ])
            for (const operation of ['create', 'update']) {
                const before = await collection.findOne({
                    _id: source._id as never,
                });
                assert.ok(before);
                const meta = structuredClone(source.meta[0]);
                meta.props[0].data = [randomUUID()];
                meta.props[1].data = [randomUUID()];
                meta.props[2].data = [{ nodes: nodes(href) }] as never;
                const payload =
                    operation === 'create'
                        ? {
                              statuses: [],
                              meta: [meta],
                              content: [{ lng: 'en', nodes: nodes(href) }],
                          }
                        : {
                              _id: source._id,
                              expectedUpdatedAt: before.updatedAt,
                              lng: 'en',
                              meta,
                              content: { nodes: nodes(href) },
                          };
                const response = await app.inject({
                    method: operation === 'create' ? 'POST' : 'PUT',
                    url: `/api/v4/template/${source.templateId}/entry/${operation}`,
                    headers: {
                        authorization: bearer(actor),
                        'x-bcms-workspace': 'own',
                        'x-bcms-site': ownSiteId,
                    },
                    payload,
                });
                assert.equal(response.statusCode, 200, response.body);
                const persisted = response.json().item;
                assert.equal(persisted.siteId, undefined);
                assert.deepEqual(persisted.content[0].nodes, nodes(href));
            }
    },
);
