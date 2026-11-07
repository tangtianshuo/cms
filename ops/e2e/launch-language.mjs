import { expect } from '@playwright/test';
import { workspace, save } from './launch-workspace.mjs';
// Only language definitions are infrastructure. Every translated Entry is authored
// through the canonical ContentWorkspace and saved through its normal button.
export async function authorPreviewLanguage(page, marker) {
    const plan = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const language = state.site.language === 'fr' ? 'de' : 'fr';
        if (!(await sdk.language.getAll()).some((l) => l.code === language))
            await sdk.language.create({
                code: language,
                name: language,
                nativeName: language,
            });
        const languages = await sdk.language.getAll();
        const entries = [];
        for (const model of state.models) {
            const template = await sdk.template.get({
                templateId: model.templateId,
            });
            for (const item of model.entries) {
                const entry = await sdk.entry.get({
                    templateId: model.templateId,
                    entryId: item.id,
                    skipCache: true,
                });
                if (entry.meta.some((m) => m.lng === language)) continue;
                const meta = entry.meta.find(
                    (m) => m.lng === state.site.language,
                );
                entries.push({
                    modelKey: model.key,
                    templateId: model.templateId,
                    entryId: entry._id,
                    fields: template.props.map((prop, index) => ({
                        index,
                        name: prop.name,
                        type: prop.type,
                        array: prop.array,
                        value: meta.props.find((p) => p.id === prop.id)
                            ?.data?.[0],
                    })),
                });
            }
        }
        return {
            language,
            originalLanguage: state.site.language,
            languageIndex: languages.findIndex((l) => l.code === language),
            workspaceId: sdk.context.context.workspaceId,
            siteId: state.site.id,
            entries,
        };
    });
    for (const entry of plan.entries) {
        await page.goto(
            '/d/studio?' +
                new URLSearchParams({
                    section: 'content',
                    workspaceId: plan.workspaceId,
                    siteId: plan.siteId,
                    modelKey: entry.modelKey,
                    templateId: entry.templateId,
                    entryId: entry.entryId,
                    language: plan.language,
                }),
        );
        await expect(workspace(page)).toBeVisible();
        await page
            .getByRole('button', { name: '创建此语言版本', exact: true })
            .click();
        const titleAndSlug = page.locator(
            '.studio-workspace-content [contenteditable="true"]',
        );
        await titleAndSlug
            .nth(0)
            .fill(
                marker + ' ' + entry.modelKey + ' ' + entry.entryId.slice(-6),
            );
        await page
            .locator(`[id="entry.meta.${plan.languageIndex}.props.1.data.0"]`)
            .fill(String(entry.fields[1].value));
        for (const field of entry.fields.slice(2)) {
            if (field.array || !['STRING', 'NUMBER'].includes(field.type))
                continue;
            const wrapper = page.locator(
                `[data-bcms-prop-input-wrapper][id="entry.meta.${plan.languageIndex}.props.${field.index}"]`,
            );
            if (field.type === 'STRING')
                await wrapper
                    .locator('[contenteditable="true"]')
                    .fill(
                        ['headline', 'brandName'].includes(field.name)
                            ? marker
                            : String(field.value || ''),
                    );
            else await wrapper.locator('input').fill(String(field.value ?? 0));
        }
        await save(page);
        const persisted = await page.evaluate(
            async ({ entry, language }) =>
                (
                    await window.bcms.sdk.entry.get({
                        templateId: entry.templateId,
                        entryId: entry.entryId,
                        skipCache: true,
                    })
                ).meta.some((m) => m.lng === language),
            { entry, language: plan.language },
        );
        expect(persisted).toBe(true);
    }
    return plan;
}
