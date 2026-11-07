import { test, expect } from './browser-fixture.mjs';
import { editStructured, retireRichEditor } from './launch-structured.mjs';
test('supporting ContentWorkspace authors reference, structured values and bound rich link', async ({
    page,
    installation,
}) => {
    test.skip(
        !process.env.E2E_B3_TEMPLATES_ROOT,
        'Explicit local artifact fixture only',
    );
    test.setTimeout(120000);
    page.setDefaultTimeout(15000);
    const input = {
        ownMedia: process.env.STOREFRONT_E2E_OWN_MEDIA,
        filename: 'B4 own image.png',
    };
    expect(input.ownMedia).toBeTruthy();
    await editStructured(page, input);
    await retireRichEditor(page, input);
});

test('required string and number scalar/array validation follows immutable current values', async ({
    page,
    installation,
}) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(15000);
    const fixture = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        let template = await sdk.template.create({
            label: 'D1 required values ' + crypto.randomUUID().slice(0, 8),
            desc: '',
            singleEntry: false,
        });
        template = await sdk.template.update({
            _id: template._id,
            propChanges: [
                ['Scalar text', 'STRING', false],
                ['Scalar number', 'NUMBER', false],
                ['Array text', 'STRING', true],
                ['Array number', 'NUMBER', true],
            ].map(([label, type, array]) => ({
                add: { label, type, array, required: true, data: {} },
            })),
        });
        const site = await sdk.studio.getSite();
        const languages = await sdk.language.getAll();
        return {
            templateId: template._id,
            workspaceId: sdk.context.context.workspaceId,
            language: site.site.language,
            languageIndex: languages.findIndex(
                (l) => l.code === site.site.language,
            ),
            props: template.props
                .slice(2)
                .map((p, i) => ({ ...p, index: i + 2 })),
        };
    });
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({
                section: 'content',
                templateId: fixture.templateId,
                entryId: 'create',
                language: fixture.language,
                workspaceId: fixture.workspaceId,
            }),
    );
    await page
        .locator('.studio-workspace-content [contenteditable="true"]')
        .first()
        .fill('D1 current values');
    const control = (prop) =>
        page.locator(
            `[data-bcms-prop-input-wrapper][id="entry.meta.${fixture.languageIndex}.props.${prop.index}"]`,
        );
    for (const prop of fixture.props) {
        const field = control(prop);
        if (
            prop.array &&
            (await field.locator('input,[contenteditable="true"]').count()) ===
                0
        )
            await field
                .getByRole('button', {
                    name: new RegExp(prop.label + '.*添加'),
                })
                .click();
        await expect(
            field.locator('input,[contenteditable="true"]'),
        ).toHaveCount(1);
        await field
            .locator('input,[contenteditable="true"]')
            .fill(prop.type === 'STRING' ? 'first valid' : '7');
    }
    const created = page.waitForResponse(
        (r) =>
            r.request().method() === 'POST' &&
            r.url().endsWith('/entry/create'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(200);
    const original = (await createdResponse.json()).item;
    await expect
        .poll(() => new URL(page.url()).searchParams.get('entryId'))
        .toBe(original._id);
    for (const prop of fixture.props)
        await control(prop)
            .locator('input,[contenteditable="true"]')
            .fill(prop.type === 'STRING' ? '' : '0');
    const writes = [];
    const observe = (request) => {
        if (
            request.method() === 'PUT' &&
            request.url().endsWith('/entry/update')
        )
            writes.push(request);
    };
    page.on('request', observe);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
        page.getByText('请检查内容字段后保存。', { exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(0);
    for (const prop of fixture.props)
        await control(prop)
            .locator('input,[contenteditable="true"]')
            .fill(prop.type === 'STRING' ? 'second valid' : '11');
    const updated = page.waitForResponse(
        (r) =>
            r.request().method() === 'PUT' && r.url().endsWith('/entry/update'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    expect((await updated).status()).toBe(200);
    expect(writes).toHaveLength(1);
    page.off('request', observe);
    const persisted = await page.evaluate(
        async (fixture) =>
            window.bcms.sdk.entry.get({
                templateId: fixture.templateId,
                entryId: fixture.entryId,
                skipCache: true,
            }),
        { ...fixture, entryId: original._id },
    );
    const before = original.meta.find((m) => m.lng === fixture.language),
        after = persisted.meta.find((m) => m.lng === fixture.language);
    for (const prop of fixture.props) {
        expect(before.props.find((p) => p.id === prop.id).data).toEqual([
            prop.type === 'STRING' ? 'first valid' : 7,
        ]);
        expect(after.props.find((p) => p.id === prop.id).data).toEqual([
            prop.type === 'STRING' ? 'second valid' : 11,
        ]);
    }
});
