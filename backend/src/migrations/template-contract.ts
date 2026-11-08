import type { PresetManifest } from '../presets/catalog';
import type { SiteInstallation } from '../presets/site-model';
import { migrateLegacyLayout } from './layout-document';

export function applyLegacyCandidateLayouts(
    candidate: SiteInstallation,
    preset: PresetManifest,
): SiteInstallation {
    const next = structuredClone(candidate);
    next.pages = next.pages.map((page) => {
        const layoutDocument = migrateLegacyLayout(next, page, preset);
        return {
            ...page,
            layoutDocument,
            sections: layoutDocument.root.map((node) => node.type),
            sectionConfigs: layoutDocument.root.map((node) => ({
                type: node.type as NonNullable<
                    typeof page.sectionConfigs
                >[number]['type'],
                enabled: node.enabled,
                data: structuredClone(node.props),
            })),
        };
    });
    next.runtimeMode = 'artifact';
    return next;
}
