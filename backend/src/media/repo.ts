import { workspaceFilter } from '../workspaces/context';
import { ContentScopeError } from '../workspaces/scoped-collection';
import {
    type Media,
    MediaSchema,
} from '@bcms/selfhosted-backend/media/models/main';
import { createMongoDBRepository } from '@bcms/selfhosted-backend/_server/modules/mongodb';
import { Config } from '@bcms/selfhosted-backend/config';

export interface MediaRepoMethods {
    findForAuthorizedBinary(id: string, workspaceId: string): Promise<Media | null>;
    findByParentIdAndName(
        parentId: string,
        name: string,
    ): Promise<Media | null>;
    findInRootByName(name: string): Promise<Media | null>;
    deleteManyById(ids: string[]): Promise<void>;
}

export const MediaRepo = createMongoDBRepository<Media, MediaRepoMethods>({
    name: 'Media',
    collection: `${Config.dbPrefix}_medias`,
    schema: MediaSchema,
    async prepareWrite(media) {
        delete media.accessToken; delete media.accessTokenExpiresAt;
        const visited = new Set([media._id]);
        let parentId = media.parentId;
        while (parentId) {
            if (visited.has(parentId)) throw new ContentScopeError('Media directory cycle is not permitted');
            visited.add(parentId);
            const parent = await MediaRepo.findById(parentId);
            if (!parent || parent.type !== 'DIR') throw new ContentScopeError('Media parent directory not found in workspace');
            parentId = parent.parentId;
        }
    },
    methods({ mdb, cache, identityCollection }) {
        return {
            findForAuthorizedBinary: (_id, workspaceId) => identityCollection.findOne({ $and: [{ _id }, workspaceFilter(workspaceId)] }),
            async findByParentIdAndName(parentId: string, name: string) {
                const cacheHit = cache.find(
                    (e) => e.parentId === parentId && e.name === name,
                );
                if (cacheHit) {
                    return cacheHit;
                }
                const result = await mdb.findOne({
                    parentId,
                    name,
                });
                if (result) {
                    cache.set(result);
                }
                return result;
            },

            async findInRootByName(name: string) {
                const cacheHit = cache.find(
                    (e) => e.isInRoot && e.name === name,
                );
                if (cacheHit) {
                    return cacheHit;
                }
                const result = await mdb.findOne({
                    isInRoot: true,
                    name,
                });
                if (result) {
                    cache.set(result);
                }
                return result;
            },

            async deleteManyById(ids) {
                await mdb.deleteMany({
                    _id: { $in: ids },
                });
                cache.remove(ids);
            },
        };
    },
});
