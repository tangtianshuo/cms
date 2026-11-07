import type { LayoutNode } from '../storefront/layout-document';
import type { ReleaseInput } from '../presets/releases';
import type { SiteInstallation, SitePage } from '../presets/site-model';
import type { PresetManifest } from '../presets/catalog';
import type { Media } from '../media/models/main';
import { PropType } from '../prop/models/main';
import { createLegacyEditorAdapter } from './compatibility';
import { mediaAuthorizedForSite } from '../storefront/section-schema';
import type { MigrationDocument, MigrationTarget } from './migration-preview';

function clone<T>(value: T): T {
    return structuredClone(value);
}

function fieldValues(
    site: SiteInstallation,
    input: ReleaseInput,
    templateId: string,
): Array<{ id: string; fields: Record<string, unknown> }> {
    const mapping = site.models.find(
        (model) => model.templateId === templateId,
    );
    if (!mapping) return [];
    const template = input.templates.find((item) => item._id === templateId);
    const propKeys = new Map(
        mapping.fields.map((field) => {
            const prop = template?.props.find(
                (item) => item.id === field.propId,
            );
            return [
                field.propId,
                {
                    key: field.key,
                    scalar: !prop?.array && prop?.type !== PropType.RICH_TEXT,
                },
            ] as const;
        }),
    );
    return input.entries
        .filter((entry) => entry.templateId === templateId)
        .map((entry) => {
            const translated = entry.meta.find(
                (meta) => meta.lng === input.language,
            );
            const fields: Record<string, unknown> = {};
            for (const value of translated?.props ?? []) {
                const mappingValue = propKeys.get(value.id);
                if (mappingValue) {
                    fields[mappingValue.key] =
                        mappingValue.scalar && Array.isArray(value.data)
                            ? clone(value.data[0])
                            : clone(value.data);
                }
            }
            return { id: entry._id, fields };
        });
}

function sectionNodes(
    page: SitePage,
): MigrationDocument['pages'][number]['sections'] {
    const nodes: LayoutNode[] = [];
    const visit = (value: LayoutNode[] | undefined): void => {
        for (const node of value ?? []) {
            if (node.kind === 'section') nodes.push(node);
            visit(node.children as LayoutNode[] | undefined);
        }
    };
    if (page.layoutDocument) {
        visit(page.layoutDocument.root);
        return nodes.map((node) => ({
            id: node.id,
            type: node.type,
            props: clone(node.props),
        }));
    }
    return (page.sectionConfigs ?? []).map((section, index) => ({
        id: `${page.key}:section:${index}:${section.type}`,
        type: section.type,
        props: clone(section.data),
    }));
}

/**
 * Project persisted CMS content into the deliberately small migration
 * document. Entry prop IDs are resolved through the installed site bindings so
 * proposed steps operate on stable field keys rather than database internals.
 */
export function toMigrationDocument(
    site: SiteInstallation,
    input: ReleaseInput,
): MigrationDocument {
    const models: MigrationDocument['models'] = {};
    for (const model of site.models) {
        models[model.key] = fieldValues(site, input, model.templateId);
    }
    return {
        models,
        pages: site.pages.map((page) => ({
            id: page.key,
            path: page.path,
            sections: sectionNodes(page),
        })),
    };
}

export function migrationTargetForManifest(
    manifest: PresetManifest,
    site: SiteInstallation,
    availableMediaIds: string[],
): MigrationTarget {
    const editor =
        manifest.editor || createLegacyEditorAdapter(manifest).contract;
    return {
        models: Object.fromEntries(
            manifest.models.map((model) => [
                model.key,
                {
                    singleEntry: model.singleEntry,
                    fields: model.fields.map((field) => ({
                        key: field.key,
                        type: field.type,
                        required: field.required,
                        array: field.array,
                        ...(field.referenceModel
                            ? { referenceModel: field.referenceModel }
                            : {}),
                    })),
                },
            ]),
        ),
        pages: manifest.pages.map((page) => ({
            key: page.key,
            path: page.path,
            sections:
                editor.pages.find((candidate) => candidate.pageKey === page.key)
                    ?.sections ?? [],
        })),
        sections: editor.sections.map((section) => ({
            type: section.type,
            allowedPages: section.allowedPages,
        })),
        availableMediaIds,
        templateIds: Object.fromEntries(
            site.models.map((model) => [model.key, model.templateId]),
        ),
    };
}

export function authorizedMigrationMediaIds(
    site: SiteInstallation,
    media: Media[],
): string[] {
    return media
        .filter((item) => mediaAuthorizedForSite(item, site))
        .map((item) => item._id);
}
