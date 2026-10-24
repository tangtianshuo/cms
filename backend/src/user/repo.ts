import { createMongoDBRepository } from '@bcms/selfhosted-backend/_server/modules/mongodb';
import {
    type User,
    UserSchema,
} from '@bcms/selfhosted-backend/user/models/main';
import { Config } from '@bcms/selfhosted-backend/config';

export interface UserRepoMethods {
    findForAuthentication(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
}

export const UserRepo = createMongoDBRepository<User, UserRepoMethods>({
    workspaceScoped: false,
    name: 'UserRepository',
    collection: `${Config.dbPrefix}_users`,
    schema: UserSchema,
    methods({ mdb, cache, identityCollection }) {
        return {
            findForAuthentication: (_id) => identityCollection.findOne({ _id }),
            async findByEmail(email) {
                const cacheHit = cache.find((e) => e.email === email);
                if (cacheHit) {
                    return cacheHit;
                }
                const user = await mdb.findOne({ email });
                if (user) {
                    cache.set(user);
                }
                return user;
            },
        };
    },
});
