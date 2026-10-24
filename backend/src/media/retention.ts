import { Repo } from '../repo';
import { copyDatabase, copyRepository, copyVisibility } from '../resource-shares/visibility';
import { workspaceFilter } from '../workspaces/context';

export class MediaRetentionError extends Error { readonly status = 409; }
/** Conservatively retain pins even when publication later fails. Clearing a pin
 * requires operator reconciliation; a failed activation cannot lose its files. */
export async function pinReleaseMedia(payload: string, releaseId: string) {
    const snapshot = JSON.parse(payload);
    const ids = new Set<string>();
    const visit = (value: unknown) => {
        if (typeof value === 'string') {
            const match = value.match(/\/api\/v4\/media\/([^/]+)\/bin\//);
            if (match) ids.add(decodeURIComponent(match[1]));
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(snapshot.pages);
    const raw = copyRepository('Media').raw;
    for (const id of ids) {
        const result = await raw.updateOne({ $and: [{ _id: id, deletionPending: { $ne: true } }, workspaceFilter(), await copyVisibility(copyDatabase())] }, { $addToSet: { retentionPins: releaseId } });
        if (result.matchedCount !== 1) throw new MediaRetentionError(`Media ${id} is missing or being deleted; publication refused`);
    }
}
/** Claim every row before removal. Publication pins use the same document CAS,
 * so publication and deletion cannot both win for a media file. */
export async function claimMediaDeletion(ids: string[], requireWorkspace = true) {
    const raw = copyRepository('Media').raw;
    for (const id of ids) {
        const reference = await Repo.storefrontRelease.methods.findRetainedMediaReference(id);
        if (reference) throw new MediaRetentionError(`Media ${id} is retained by published Releases for site ${reference.siteId}`);
        const owner = requireWorkspace ? workspaceFilter() : {};
        const media = await raw.findOne({ $and: [{ _id: id }, owner] });
        if (!media) continue;
        if (media.retentionPins?.length) throw new MediaRetentionError(`Media ${id} is retained by a Release`);
    }
    for (const id of ids) {
        const owner = requireWorkspace ? workspaceFilter() : {};
        const result = await raw.updateOne({ $and: [{ _id: id, retentionPins: { $not: { $elemMatch: { $exists: true } } } }, owner] }, { $set: { deletionPending: true } });
        if (result.matchedCount !== 1 && await raw.findOne({ $and: [{ _id: id }, owner] })) throw new MediaRetentionError(`Media ${id} became retained during deletion`);
    }
}
