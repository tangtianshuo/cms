import { randomUUID } from 'node:crypto';
import { Repo } from '../repo';
import { copyDatabase, copyRepository, copyVisibility } from '../resource-shares/visibility';
import { workspaceFilter } from '../workspaces/context';

export class MediaRetentionError extends Error { readonly status = 409; }
/** Acquire every asset under an attempt-specific lock before creating Release pins.
 * Known acquisition failures undo only this attempt. Unknown write outcomes and
 * later publication failures remain retained for operator reconciliation. */
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
    const attemptPin = `release-attempt:${releaseId}:${randomUUID()}`;
    const acquired: string[] = [];
    try {
        for (const id of ids) {
            const result = await raw.updateOne({ $and: [{ _id: id, deletionPending: { $ne: true } }, workspaceFilter(), await copyVisibility(copyDatabase())] },
                { $addToSet: { retentionPins: attemptPin } });
            if (result.matchedCount !== 1) throw new MediaRetentionError(`Media ${id} is missing or being deleted; publication refused`);
            acquired.push(id);
        }
    } catch (cause) {
        if (cause instanceof MediaRetentionError && acquired.length) {
            // Never remove releaseId: another attempt may already have committed it.
            // A failed cleanup propagates its unknown outcome instead of claiming rollback.
            await raw.updateMany({ $and: [{ _id: { $in: acquired }, retentionPins: attemptPin }, workspaceFilter()] },
                [{ $set: { retentionPins: { $setDifference: [{ $ifNull: ['$retentionPins', []] }, [attemptPin]] } } }]);
        }
        throw cause;
    }
    for (const id of acquired) {
        const result = await raw.updateOne({ $and: [{ _id: id, retentionPins: attemptPin, deletionPending: { $ne: true } }, workspaceFilter()] }, [
            { $set: { retentionPins: { $setUnion: [
                { $setDifference: [{ $ifNull: ['$retentionPins', []] }, [attemptPin]] }, [releaseId],
            ] } } },
        ]);
        // Earlier assets may already have permanent pins; any failure here must keep them.
        if (result.matchedCount !== 1) throw new Error(`Media ${id} retention lock changed; publication deferred`);
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
