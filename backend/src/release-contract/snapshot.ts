import type { ReleaseSnapshot } from '../presets/releases';

export interface ContractAsset {
    path: string;
    checksum: string;
    mimeType: string;
    url?: string;
    mediaId?: string;
    sourcePath?: string;
    /** Immutable bytes uploaded with the release artifact. */
    contentBase64?: string;
}

export interface ContractTemplateIdentity {
    id: string;
    version: string;
}

export interface ContractSnapshotV1 extends ReleaseSnapshot {
    contractVersion: 1;
    template: ContractTemplateIdentity;
    assets: ContractAsset[];
}

function templateIdentity(snapshot: ReleaseSnapshot): ContractTemplateIdentity {
    const identities = snapshot.pages.map(page => ({ id: page.content.preset.id, version: page.content.preset.version }));
    const first = identities[0];
    if (!first?.id || !first.version || identities.some(item => item.id !== first.id || item.version !== first.version)) {
        throw new Error('Release pages do not share one template identity');
    }
    return first;
}

/** Project the internal CMS release into the versioned cross-repository contract. */
export function toContractSnapshot(snapshot: ReleaseSnapshot, assets: ContractAsset[] = []): ContractSnapshotV1 {
    if (snapshot.schemaVersion !== 1 || !snapshot.workspaceId || !snapshot.siteId || !snapshot.language) {
        throw new Error('Release snapshot is missing contract identity');
    }
    const template = templateIdentity(snapshot);
    return structuredClone({
        contractVersion: 1 as const,
        schemaVersion: 1 as const,
        workspaceId: snapshot.workspaceId!,
        siteId: snapshot.siteId,
        language: snapshot.language,
        template,
        pages: snapshot.pages.map((page) => ({
            path: page.path,
            pageKey: page.pageKey,
            entryId: page.entryId,
            content: {
                kind: page.content.kind,
                view: page.content.view,
                preset: page.content.preset,
                sections: page.content.sections,
                ...(page.content.sectionConfigs ? { sectionConfigs: page.content.sectionConfigs } : {}),
                ...(page.content.layoutDocument ? { layoutDocument: page.content.layoutDocument } : {}),
                seo: page.content.seo,
                ...(page.content.items ? { items: page.content.items } : {}),
                ...(page.content.operations ? { operations: page.content.operations } : {}),
            },
            ...(page.layoutDocument ? { layoutDocument: page.layoutDocument } : {}),
        })),
        navigation: snapshot.navigation,
        redirects: snapshot.redirects,
        ...(snapshot.operations ? { operations: snapshot.operations } : {}),
        assets,
    });
}

/** Replace CMS media URLs with paths served by the published runtime artifact. */
export function rewriteContractMediaUrls<T extends ReleaseSnapshot>(snapshot: T, assets: ContractAsset[]): T {
    const byMediaId = new Map(assets.filter((asset) => asset.mediaId).map((asset) => [asset.mediaId!, asset.path]));
    const mediaUrl = /(?:https?:\/\/[^/]+)?\/api\/v4\/media\/([^/]+)\/bin\/[^?#]+(?:\?[^#]*)?/g;
    const visit = (value: unknown): unknown => {
        if (typeof value === 'string') {
            return value.replace(mediaUrl, (match, encodedId: string) => {
                let id: string;
                try { id = decodeURIComponent(encodedId); } catch { return match; }
                const path = byMediaId.get(id);
                return path ? `/_assets/${path}` : match;
            });
        }
        if (Array.isArray(value)) return value.map(visit);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
        }
        return value;
    };
    return visit(structuredClone(snapshot)) as T;
}
