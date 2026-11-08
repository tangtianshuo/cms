import { createHash } from 'node:crypto';
import { pageDraft } from '../presets/pages';
import type { PresetManifest } from '../presets/catalog';
import type { SiteInstallation, SitePage } from '../presets/site-model';
import {
    layoutFromSectionConfigs,
    validateLayoutDocument,
    type LayoutContract,
    type LayoutDocument,
} from '../storefront/layout-document';

function nodeId(
    site: SiteInstallation,
    page: SitePage,
    type: string,
    index: number,
    priorId?: string,
): string {
    return createHash('sha256')
        .update(`${site._id}:${page.key}:${priorId || `${type}:${index}`}`)
        .digest('hex')
        .slice(0, 24);
}

function contractForPage(
    preset: PresetManifest,
    page: SitePage,
): LayoutContract | undefined {
    const editorPage = preset.editor?.pages.find(
        (candidate) => candidate.pageKey === (page.blueprintKey || page.key),
    );
    if (!editorPage) return undefined;
    const allowed =
        editorPage.sections.length > 0
            ? editorPage.sections
            : (preset.editor?.sections || [])
                  .filter((section) =>
                      section.allowedPages.includes(editorPage.pageKey),
                  )
                  .map((section) => section.type);
    return {
        sections: (preset.editor?.sections || [])
            .filter((section) => allowed.includes(section.type))
            .map((section) => ({
                type: section.type,
                singleton: section.singleton,
                required: section.required,
                props: section.props,
            })),
    };
}

export function migrateLegacyLayout(
    site: SiteInstallation,
    page: SitePage,
    preset: PresetManifest,
): LayoutDocument {
    const draft = pageDraft(
        {
            ...site,
            publishedTemplateRecord: undefined,
            presetManifestSnapshot: JSON.stringify(preset),
        },
        page.key,
    );
    const configs =
        page.sectionConfigs ||
        draft?.sectionConfigs ||
        (page.sections || []).map((type) => ({
            type: type as SitePage['sectionConfigs'] extends Array<infer T>
                ? T extends { type: infer Type }
                    ? Type
                    : never
                : never,
            enabled: true,
            data: {},
        })) ||
        [];
    const layout = layoutFromSectionConfigs(configs);
    layout.root = layout.root.map((node, index) => ({
        ...node,
        id: nodeId(
            site,
            page,
            node.type,
            index,
            page.layoutDocument?.root[index]?.id,
        ),
    }));
    validateLayoutDocument(layout, contractForPage(preset, page));
    return layout;
}
