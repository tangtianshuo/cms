import type { PresetManifest } from '../presets/catalog';
import { resolveInstalledPreset } from '../presets/installed';
import {
    buildRelease,
    ReleaseValidationError,
    type ReleaseInput,
} from '../presets/releases';
import type { SiteInstallation } from '../presets/site-model';
import { validateSectionMediaReferences } from '../storefront/section-schema';
import { applyLegacyCandidateLayouts } from './template-contract';

export interface LegacySiteMigrationPlan {
    candidateSite: SiteInstallation;
    issues: Array<{ code: string; path: string }>;
}

export function siteRuntimeMode(
    site: Pick<SiteInstallation, 'runtimeMode'>,
): 'legacy' | 'artifact' {
    return site.runtimeMode === 'artifact' ? 'artifact' : 'legacy';
}

export function planLegacySiteMigration(
    site: SiteInstallation,
    input: ReleaseInput,
): LegacySiteMigrationPlan {
    if (input.site._id !== site._id) {
        throw new Error('Release input belongs to another site');
    }
    const preset = resolveInstalledPreset(site);
    const candidateSite = applyLegacyCandidateLayouts(site, preset);
    const issues: Array<{ code: string; path: string }> = [];
    for (const page of candidateSite.pages) {
        try {
            validateSectionMediaReferences(
                page.layout,
                page.sectionConfigs || [],
                { media: input.media, site },
            );
        } catch (error) {
            issues.push({
                code: /missing|not available|media/i.test(
                    error instanceof Error ? error.message : '',
                )
                    ? 'media_missing'
                    : 'section_invalid',
                path: `page/${page.key}`,
            });
        }
    }
    if (!issues.length) {
        try {
            buildRelease({ ...input, site: candidateSite });
        } catch (error) {
            if (error instanceof ReleaseValidationError) {
                for (const issue of error.issues) {
                    issues.push({
                        code: issue.code,
                        path: [
                            issue.pageKey,
                            issue.modelKey,
                            issue.entryId,
                            issue.field,
                        ]
                            .filter(Boolean)
                            .join('/'),
                    });
                }
            } else {
                issues.push({
                    code: 'candidate_invalid',
                    path: 'candidate',
                });
            }
        }
    }
    return { candidateSite, issues };
}

export function candidateLayoutTransform(
    preset: PresetManifest,
): (candidate: SiteInstallation) => SiteInstallation {
    return (candidate) => applyLegacyCandidateLayouts(candidate, preset);
}
