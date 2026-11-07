import type { GatewayReleaseSource } from '../presets/gateway-publish';
import type { ReleaseInput } from '../presets/releases';
import type { SiteInstallation } from '../presets/site-model';
import type { MigrationOperation } from './migration-repo';

export interface MigrationSourceOptions {
    base: GatewayReleaseSource;
    language?: string;
    mediaOrigin?: string;
    currency?: string;
    update(operation: MigrationOperation): Promise<MigrationOperation | void>;
}

/**
 * Bind a durable migration operation to the existing Release/Gateway source.
 * Content reads are namespace-isolated; release persistence and Gateway
 * activation continue through the accepted source implementation.
 */
export function createMigrationReleaseSource(
    operation: MigrationOperation,
    options?: MigrationSourceOptions,
): GatewayReleaseSource {
    if (!options) {
        throw new TypeError(
            'Migration release source options are required at the integration boundary',
        );
    }
    let current = structuredClone(operation);
    return {
        findSite: async () => structuredClone(current.candidateSite),
        async loadContent(
            site: SiteInstallation,
        ): Promise<Omit<ReleaseInput, 'site'>> {
            if (
                site._id !== current.cmsSiteId ||
                site.templateNamespace !==
                    current.candidateSite.templateNamespace
            ) {
                throw new Error('Migration candidate identity mismatch');
            }
            return {
                templates: structuredClone(current.candidateTemplates ?? []),
                entries: structuredClone(current.candidateEntries ?? []),
                media: structuredClone(current.media ?? []),
                language: site.language || options.language || 'en',
                mediaOrigin: options.mediaOrigin || '',
                currency: options.currency || 'USD',
            };
        },
        findRelease: (id) => options.base.findRelease(id),
        insertRelease: (record) => options.base.insertRelease(record),
        activate: (site, releaseId) => options.base.activate(site, releaseId),
        audit: (event) => options.base.audit(event),
        async saveSite(site, expectedUpdatedAt) {
            if (
                site._id !== current.cmsSiteId ||
                current.candidateSite.updatedAt !== expectedUpdatedAt
            ) {
                return false;
            }
            current = {
                ...current,
                candidateSite: {
                    ...structuredClone(site),
                    updatedAt: site.updatedAt,
                },
                updatedAt: site.updatedAt,
            };
            await options.update(current);
            return true;
        },
        async projectGatewayRelease(site, releaseId, revision) {
            if (
                site._id !== current.cmsSiteId ||
                (site.workspaceId || 'default') !== current.cmsWorkspaceId
            ) {
                return false;
            }
            current = {
                ...current,
                candidateSite: {
                    ...structuredClone(site),
                    gatewayCurrentReleaseId: releaseId,
                    gatewayActiveRevision: revision,
                    gatewayPublishedReleaseIds: [
                        ...new Set([
                            ...(site.gatewayPublishedReleaseIds || []),
                            releaseId,
                        ]),
                    ],
                },
                updatedAt: Math.max(Date.now(), site.updatedAt + 1),
            };
            await options.update(current);
            return true;
        },
    };
}
