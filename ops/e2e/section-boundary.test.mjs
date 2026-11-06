// Local source contract coverage across actual new-version manifests and renderers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
const templatesRoot = process.env.E2E_SECTION_TEMPLATES_ROOT;
const require = createRequire(import.meta.url);
for (const [id, version] of [['aeroframe', '1.0.4'], ['fireguard', '1.0.1']]) {
    test(`${id} actual grid declaration agrees with UI, normalized layout/server and renderer`, { skip: !templatesRoot ? 'Set E2E_SECTION_TEMPLATES_ROOT for actual local template source coverage' : false }, async () => {
        const { normalizePublicManifest } = require('../../backend/src/presets/registry.ts');
        const { normalizeLayoutDocument, layoutFromSectionConfigs } = require('../../backend/src/storefront/layout-document.ts');
        const { validateDeclaredSectionProperties } = require('../../backend/src/storefront/section-schema.ts');
        const ts = require('typescript');
        const uiSource = await readFile(new URL('../../ui/src/components/studio/section-property-state.ts', import.meta.url), 'utf8');
        const uiModule = ts.transpileModule(uiSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
        const { sectionPropertyFields, updateSectionField } = await import(`data:text/javascript;base64,${Buffer.from(uiModule).toString('base64')}`);
        const { editorSchemaForSection } = require('../../backend/src/template-contract/editor-schema.ts');
        const directory = path.join(templatesRoot, 'templates', id, version);
        const raw = JSON.parse(await readFile(path.join(directory, 'template.json'), 'utf8'));
        const manifest = normalizePublicManifest(raw, { id, version });
        const definitions = manifest.editor.sections.filter(section => ['heading', 'grid'].includes(section.type));
        const field = sectionPropertyFields(definitions.find(section => section.type === 'grid').props)[0];
        assert.equal(field.minimum, 1);
        assert.equal(field.integer, true);
        assert.equal(editorSchemaForSection(manifest, 'grid')[0].minimum, 1);
        const { previewPage } = await import(pathToFileURL(path.join(directory, 'storefront/shared/snapshot.mjs')).href);
        for (const columns of [0, -1, 1.5, 3, 4]) {
            const valid = Number.isInteger(columns) && columns >= 1;
            const configs = [{ type: 'heading', enabled: true, data: { title: 'Catalog' } }, { type: 'grid', enabled: true, data: { columns } }];
            const layout = layoutFromSectionConfigs(configs);
            const validate = () => normalizeLayoutDocument(layout, { sections: definitions });
            const validateServer = () => validateDeclaredSectionProperties(configs, definitions, { media: [], site: { _id: 'local-site', workspaceId: 'local-workspace' } });
            if (valid) { assert.doesNotThrow(validate); assert.doesNotThrow(validateServer); }
            else { assert.throws(validate); assert.throws(validateServer); }
            assert.equal(updateSectionField({ columns: 3 }, field, String(columns)).error === null, valid);
            const content = { kind: 'preset-page', view: 'collection', preset: { id, version, name: raw.name, description: raw.description, ...raw.presentation }, sections: ['heading', 'grid'], seo: { title: 'Catalog', description: '' }, items: [] };
            const snapshot = { schemaVersion: 1, workspaceId: 'local-workspace', siteId: 'local-site', language: 'en', pages: [{ path: '/catalog', pageKey: 'collections', entryId: 'local-entry', layoutDocument: layout, content }], navigation: [], redirects: [] };
            assert.equal(previewPage(snapshot, '/catalog') !== null, valid, `renderer columns=${columns}`);
        }
    });
}
