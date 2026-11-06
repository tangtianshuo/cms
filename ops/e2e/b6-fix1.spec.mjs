import { test, expect } from './browser-fixture.mjs';

// Focused follow-up cases for B6 review I1/I2. I3 has a real HTTP+Mongo test
// with independently authenticated admin/editor principals in the backend suite.
test('B6 fix1 known-tree grammar rejects every adopted HTTP write without persistence', async ({
    page,
    installation,
}) => {
    const result = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find(
            (model) => model.key === 'content-page',
        );
        const template = await sdk.template.get({
            templateId: model.templateId,
        });
        const richId = template.props.find(
            (prop) => prop.type === 'RICH_TEXT',
        ).id;
        const get = () =>
            sdk.entry.get({
                templateId: model.templateId,
                entryId: model.entries[0].id,
                skipCache: true,
            });
        const list = () =>
            sdk.entry.getAllByTemplateId({
                templateId: model.templateId,
                skipCache: true,
            });
        const original = await get();
        const originalEntries = await list();
        const targetPage = state.site.pages.find((page) =>
            page.layoutDocument?.root.some(
                (node) =>
                    state.site.editorContract.sections.find(
                        (section) => section.type === node.type,
                    )?.props.body?.control === 'rich-text',
            ),
        );
        const sectionId = targetPage.layoutDocument.root.find(
            (node) =>
                state.site.editorContract.sections.find(
                    (section) => section.type === node.type,
                )?.props.body?.control === 'rich-text',
        ).id;
        const paragraph = {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Retained' }],
        };
        const invalid = [
            [{ type: 'text', text: 'Root text' }],
            [{ type: 'paragraph', content: [paragraph] }],
            [{ type: 'bulletList', content: [paragraph] }],
            [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
        ];
        const outcomes = [];
        const retained = [];
        const status = async (fn) => {
            try {
                await fn();
                return 200;
            } catch (error) {
                return error.response?.status || error.status || 0;
            }
        };
        for (const nodes of invalid) {
            const meta = structuredClone(
                original.meta.find((meta) => meta.lng === state.site.language),
            );
            meta.props.find((prop) => prop.id === richId).data = [{ nodes }];
            outcomes.push(
                await status(() =>
                    sdk.entry.update({
                        _id: original._id,
                        templateId: template._id,
                        expectedUpdatedAt: original.updatedAt,
                        lng: meta.lng,
                        meta,
                        content: { nodes },
                    }),
                ),
            );
            const createMeta = structuredClone(meta);
            createMeta.props[0].data = [crypto.randomUUID()];
            createMeta.props[1].data = [crypto.randomUUID()];
            outcomes.push(
                await status(() =>
                    sdk.entry.create({
                        templateId: template._id,
                        data: {
                            statuses: [],
                            meta: [createMeta],
                            content: [{ lng: meta.lng, nodes }],
                        },
                    }),
                ),
            );
            outcomes.push(
                await status(() =>
                    sdk.studio.saveEntry(model.key, {
                        entryId: original._id,
                        expectedUpdatedAt: original.updatedAt,
                        operationId: crypto.randomUUID(),
                        fields: {
                            body: { kind: 'prop-data', data: [{ nodes }] },
                        },
                    }),
                ),
            );
            const layoutDocument = structuredClone(targetPage.layoutDocument);
            layoutDocument.root.find(
                (node) => node.id === sectionId,
            ).props.body = { nodes };
            outcomes.push(
                await status(() =>
                    sdk.studio.savePage(targetPage.key, {
                        expectedUpdatedAt: state.site.updatedAt,
                        title: targetPage.title,
                        path: targetPage.path,
                        seoTitle: targetPage.seoTitle,
                        seoDescription: targetPage.seoDescription,
                        sections: targetPage.sections,
                        layoutDocument,
                        entryId: targetPage.entryId,
                        enabled: targetPage.enabled,
                        navigation: targetPage.navigation,
                    }),
                ),
            );
            retained.push(
                JSON.stringify(await get()) === JSON.stringify(original) &&
                    JSON.stringify(await list()) ===
                        JSON.stringify(originalEntries) &&
                    JSON.stringify((await sdk.studio.getSite()).site) ===
                        JSON.stringify(state.site),
            );
        }
        const widget = await sdk.widget.create({
            label: 'B6 grammar widget ' + crypto.randomUUID().slice(0, 8),
            desc: '',
        });
        const nodes = [
            {
                type: 'bulletList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            paragraph,
                            {
                                type: 'orderedList',
                                content: [
                                    {
                                        type: 'listItem',
                                        content: [
                                            paragraph,
                                            {
                                                type: 'widget',
                                                attrs: {
                                                    data: {
                                                        _id: widget._id,
                                                        props: [],
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ];
        const controls = [];
        for (const control of [[], nodes]) {
            const raw = await get();
            const meta = structuredClone(
                raw.meta.find((meta) => meta.lng === state.site.language),
            );
            meta.props.find((prop) => prop.id === richId).data = [
                { nodes: control },
            ];
            controls.push(
                await status(() =>
                    sdk.entry.update({
                        _id: raw._id,
                        templateId: raw.templateId,
                        expectedUpdatedAt: raw.updatedAt,
                        lng: meta.lng,
                        meta,
                        content: { nodes: control },
                    }),
                ),
            );
            const fresh = await get();
            controls.push(
                await status(() =>
                    sdk.studio.saveEntry(model.key, {
                        entryId: fresh._id,
                        expectedUpdatedAt: fresh.updatedAt,
                        operationId: crypto.randomUUID(),
                        fields: {
                            body: {
                                kind: 'prop-data',
                                data: [{ nodes: control }],
                            },
                        },
                    }),
                ),
            );
            const createMeta = structuredClone(meta);
            createMeta.props[0].data = [crypto.randomUUID()];
            createMeta.props[1].data = [crypto.randomUUID()];
            controls.push(
                await status(() =>
                    sdk.entry.create({
                        templateId: template._id,
                        data: {
                            statuses: [],
                            meta: [createMeta],
                            content: [{ lng: meta.lng, nodes: control }],
                        },
                    }),
                ),
            );
            const current = await sdk.studio.getSite();
            const currentPage = current.site.pages.find(
                (page) => page.key === targetPage.key,
            );
            const layoutDocument = structuredClone(currentPage.layoutDocument);
            layoutDocument.root.find(
                (node) => node.id === sectionId,
            ).props.body = { nodes: control };
            controls.push(
                await status(() =>
                    sdk.studio.savePage(currentPage.key, {
                        expectedUpdatedAt: current.site.updatedAt,
                        title: currentPage.title,
                        path: currentPage.path,
                        seoTitle: currentPage.seoTitle,
                        seoDescription: currentPage.seoDescription,
                        sections: currentPage.sections,
                        layoutDocument,
                        entryId: currentPage.entryId,
                        enabled: currentPage.enabled,
                        navigation: currentPage.navigation,
                    }),
                ),
            );
        }
        return { outcomes, retained, controls };
    });
    expect(result.outcomes).toEqual(Array(16).fill(400));
    expect(result.retained).toEqual(Array(4).fill(true));
    expect(result.controls).toEqual(Array(8).fill(200));
});

async function editWidget(container, suffix) {
    await expect(
        container.getByRole('textbox', { name: 'Widget title', exact: true }),
    ).toBeVisible();
    await container
        .getByRole('textbox', { name: 'Widget title', exact: true })
        .fill('Edited ' + suffix);
    await container.getByRole('button', { name: /Widget tags/ }).click();
    await container
        .getByRole('textbox', { name: 'Widget tags', exact: true })
        .nth(2)
        .fill('Third ' + suffix);
    await container
        .getByRole('button', { name: '上移此项', exact: true })
        .nth(2)
        .click();
    await container
        .getByRole('button', { name: '删除此项', exact: true })
        .nth(0)
        .click();
}
async function expectWidget(container, suffix) {
    await expect(
        container.getByRole('textbox', { name: 'Widget title', exact: true }),
    ).toHaveText('Edited ' + suffix);
    await expect(
        container.getByRole('textbox', { name: 'Widget tags', exact: true }),
    ).toHaveText(['Third ' + suffix, 'Second']);
}

test('B6 fix1 actual rich widgets edit body metadata and declared section then save and reload', async ({
    page,
    installation,
}, info) => {
    const fixture = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const suffix = crypto.randomUUID().slice(0, 8);
        let widget = await sdk.widget.create({
            label: 'B6 rich node ' + suffix,
            desc: '',
        });
        widget = await sdk.widget.update({
            _id: widget._id,
            propChanges: [
                {
                    add: {
                        label: 'Widget title',
                        type: 'STRING',
                        required: false,
                        array: false,
                        data: {},
                    },
                },
                {
                    add: {
                        label: 'Widget tags',
                        type: 'STRING',
                        required: false,
                        array: true,
                        data: {},
                    },
                },
            ],
        });
        let template = await sdk.template.create({
            label: 'B6 rich node model ' + suffix,
            desc: '',
            singleEntry: false,
        });
        template = await sdk.template.update({
            _id: template._id,
            propChanges: [
                {
                    add: {
                        label: 'Rich widget body',
                        type: 'RICH_TEXT',
                        required: false,
                        array: false,
                        data: {},
                    },
                },
            ],
        });
        const paragraph = (text) => ({
            type: 'paragraph',
            content: [{ type: 'text', text }],
        });
        const nodes = [
            paragraph('Before neighbor'),
            {
                type: 'widget',
                attrs: {
                    data: {
                        _id: widget._id,
                        props: [
                            { id: widget.props[0].id, data: ['Before'] },
                            {
                                id: widget.props[1].id,
                                data: ['First', 'Second'],
                            },
                        ],
                    },
                },
            },
            paragraph('After neighbor'),
        ];
        const languages = await sdk.language.getAll();
        if (!languages.some((language) => language.code === 'zh'))
            await sdk.language.create({
                code: 'zh',
                name: 'Chinese',
                nativeName: '中文',
            });
        const values = (language) =>
            template.props.map((prop, index) => ({
                id: prop.id,
                data:
                    index === 0
                        ? ['Widget ' + language + suffix]
                        : index === 1
                          ? ['widget-' + language + suffix]
                          : [{ nodes: structuredClone(nodes) }],
            }));
        const entry = await sdk.entry.create({
            templateId: template._id,
            data: {
                statuses: [],
                meta: ['en', 'zh'].map((lng) => ({ lng, props: values(lng) })),
                content: ['en', 'zh'].map((lng) => ({
                    lng,
                    nodes: structuredClone(nodes),
                })),
            },
        });
        const targetPage = state.site.pages.find((page) =>
            page.layoutDocument?.root.some(
                (node) =>
                    state.site.editorContract.sections.find(
                        (section) => section.type === node.type,
                    )?.props.body?.control === 'rich-text',
            ),
        );
        const section = targetPage.layoutDocument.root.find(
            (node) =>
                state.site.editorContract.sections.find(
                    (section) => section.type === node.type,
                )?.props.body?.control === 'rich-text',
        );
        const layoutDocument = structuredClone(targetPage.layoutDocument);
        layoutDocument.root.find((node) => node.id === section.id).props.body =
            { nodes };
        await sdk.studio.savePage(targetPage.key, {
            expectedUpdatedAt: state.site.updatedAt,
            title: targetPage.title,
            path: targetPage.path,
            seoTitle: targetPage.seoTitle,
            seoDescription: targetPage.seoDescription,
            sections: targetPage.sections,
            layoutDocument,
            entryId: targetPage.entryId,
            enabled: targetPage.enabled,
            navigation: targetPage.navigation,
        });
        return {
            templateId: template._id,
            entryId: entry._id,
            richName: template.props[2].name,
            language: 'en',
            zhMeta: entry.meta.find((meta) => meta.lng === 'zh'),
            zhBody: entry.content.find((content) => content.lng === 'zh'),
            pageKey: targetPage.key,
            sectionId: section.id,
        };
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({
                section: 'content',
                templateId: fixture.templateId,
                entryId: fixture.entryId,
                language: fixture.language,
            }),
    );
    const body = page.locator('[id="entry.content.0.nodes"]');
    const metadata = page.locator(
        `.studio-structured-field[data-field="${fixture.richName}"]`,
    );
    await editWidget(body, 'body');
    await editWidget(metadata, 'metadata');
    const saved = page.waitForResponse(
        (response) =>
            response.request().method() === 'PUT' &&
            response.url().endsWith('/entry/update'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expectWidget(body, 'body');
    await expectWidget(metadata, 'metadata');
    const preserved = await page.evaluate(async (fixture) => {
        const entry = await window.bcms.sdk.entry.get({
            templateId: fixture.templateId,
            entryId: fixture.entryId,
            skipCache: true,
        });
        const neighbors = (nodes) => [
            nodes[0].content[0].text,
            nodes[2].content[0].text,
        ];
        return {
            zhMeta: entry.meta.find((meta) => meta.lng === 'zh'),
            zhBody: entry.content.find((content) => content.lng === 'zh'),
            bodyNeighbors: neighbors(entry.content[0].nodes),
            metaNeighbors: neighbors(entry.meta[0].props[2].data[0].nodes),
            canonical:
                typeof entry.content[0].nodes[1].attrs.data === 'object' &&
                typeof entry.meta[0].props[2].data[0].nodes[1].attrs.data ===
                    'object',
        };
    }, fixture);
    expect(preserved).toEqual({
        zhMeta: fixture.zhMeta,
        zhBody: fixture.zhBody,
        bodyNeighbors: ['Before neighbor', 'After neighbor'],
        metaNeighbors: ['Before neighbor', 'After neighbor'],
        canonical: true,
    });
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({ section: 'pages', pageKey: fixture.pageKey }),
    );
    await page
        .locator('.studio-visual-node-button')
        .filter({ hasText: /商品详情|品牌故事/ })
        .first()
        .click();
    const section = page.locator(`#section-${fixture.sectionId}-body`);
    await editWidget(section, 'section');
    const savedSection = page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/studio/pages/'),
    );
    await page
        .getByRole('button', { name: '保存页面设置', exact: true })
        .click();
    expect((await savedSection).status()).toBe(200);
    await page.reload();
    await page
        .locator('.studio-visual-node-button')
        .filter({ hasText: /商品详情|品牌故事/ })
        .first()
        .click();
    await expectWidget(section, 'section');
    expect(errors).toEqual([]);
    await page.screenshot({
        path: info.outputPath('rich-widget-saved.png'),
        mask: [
            page.getByText(process.env.STOREFRONT_E2E_EMAIL, { exact: false }),
        ],
    });
});
