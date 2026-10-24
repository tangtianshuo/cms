import { Repo } from '../repo';
import { UserFactory } from '../user/factory';
import type { UserRoleName } from '../user/models/role';

// HTTP authentication reads persisted identities, even when the JWT is test-issued.
export async function seedIdentity(id: string, role: UserRoleName = 'ADMIN') {
    return Repo.user.add({ ...UserFactory.create({
        email: `${id}@acceptance.invalid`, username: id, password: 'not-a-login-password',
        roles: [{ name: role, permissions: [] }],
        customPool: { personal: { firstName: id, lastName: 'Test', avatarUri: '' }, address: {},
            policy: { templates: [], media: { get: false, post: false, put: false, delete: false } } },
    }), _id: id });
}
