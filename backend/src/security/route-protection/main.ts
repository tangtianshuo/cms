import { Repo } from '../../repo';
import { verifyRequestWorkspace } from '../../workspaces/auth';
import { verifiedWorkspace } from '../../workspaces/context';
import { HttpStatus } from '../../_server';
import type { UserJwt } from '@bcms/selfhosted-backend/user/models/main';
import type { ApiKey } from '@bcms/selfhosted-backend/api-key/models/main';
import type { ObjectSchema } from '@bcms/selfhosted-utils/object-utility';
import type { ControllerMethodPreRequestHandler } from '@bcms/selfhosted-backend/_server';

import { RPBodyCheck } from '@bcms/selfhosted-backend/security/route-protection/body-check';
import { RPJwt } from '@bcms/selfhosted-backend/security/route-protection/jwt';
import { RPApiKey } from '@bcms/selfhosted-backend/security/route-protection/api-key';
import type { UserRoleName } from '@bcms/selfhosted-backend/user/models/role';

export interface RPBodyCheckResult<Body> {
    body: Body;
}

export interface RPJwtCheckResult {
    token: UserJwt;
}

export interface RPJwtBodyCheckResult<Body> {
    token: UserJwt;
    body: Body;
}

export interface RPApiKeyCheckResult {
    apiKey: ApiKey;
}

export interface RPApiKeyBodyCheckResult<Body> {
    apiKey: ApiKey;
    body: Body;
}

export interface RPApiKeyJwtCheckResult {
    apiKey?: ApiKey;
    token?: UserJwt;
}

export interface RPApiKeyJwtBodyCheckResult<Body> {
    apiKey?: ApiKey;
    token?: UserJwt;
    body: Body;
}

/**
 * RP - Route Protection
 */
export class RP {
    private static body = new RPBodyCheck();
    private static jwt = new RPJwt();
    private static apiKey = new RPApiKey();

    static createBodyCheck<Body = unknown>(
        schema: ObjectSchema,
    ): ControllerMethodPreRequestHandler<RPBodyCheckResult<Body>> {
        return async (data) => {
            return {
                body: this.body.verify(
                    data.request.body,
                    schema,
                    data.errorHandler,
                ),
            };
        };
    }

    static createJwtCheck(
        roles?: UserRoleName[],
    ): ControllerMethodPreRequestHandler<RPJwtCheckResult> {
        return async (data) => {
            const token = this.jwt.verify(data.errorHandler, data.request.headers.authorization || (data.request.query as any).at, roles);
            const user = await Repo.user.methods.findForAuthentication(token.payload.userId);
            // SUDO is a persisted instance role, never a token-only elevation.
            const allowedRoles = [...(roles || ['USER']), 'ADMIN', 'SUDO'];
            if (!user || !user.roles.some(role => allowedRoles.includes(role.name))) throw data.errorHandler(HttpStatus.Forbidden, 'User access revoked');
            return { token, ...await verifyRequestWorkspace(data, { userId: user._id, roles: user.roles.map(role => role.name) }, user.customPool.policy) };
        };
    }

    static createWorkspaceAdminCheck(): ControllerMethodPreRequestHandler<RPJwtCheckResult> {
        return async (data) => {
            const result = await this.createJwtCheck(['USER'])(data);
            const context = (result as RPJwtCheckResult & { [verifiedWorkspace]: import('../../workspaces/context').WorkspaceContext })[verifiedWorkspace];
            if (!context.admin) throw data.errorHandler(HttpStatus.Forbidden, 'Workspace administrator required');
            return result;
        };
    }

    /** Content administration accepts an administrator of the verified workspace. */
    static createContentJwtCheck(roles?: UserRoleName[]): ControllerMethodPreRequestHandler<RPJwtCheckResult> {
        return roles?.includes('ADMIN') ? this.createWorkspaceAdminCheck() : this.createJwtCheck(roles);
    }
    static createContentJwtBodyCheck<Body = unknown>(schema: ObjectSchema, roles?: UserRoleName[]): ControllerMethodPreRequestHandler<RPJwtBodyCheckResult<Body>> {
        return async data => ({ ...await this.createBodyCheck<Body>(schema)(data), ...await this.createContentJwtCheck(roles)(data) });
    }
    static createContentApiKeyJwtCheck(roles?: UserRoleName[]): ControllerMethodPreRequestHandler<RPApiKeyJwtCheckResult> {
        return async data => data.request.headers.authorization?.startsWith('ApiKey ') || (data.request.query as { apiKey?: string }).apiKey
            ? this.createApiKeyCheck()(data) : this.createContentJwtCheck(roles)(data);
    }
    static createContentApiKeyJwtBodyCheck<Body = unknown>(schema: ObjectSchema, roles?: UserRoleName[]): ControllerMethodPreRequestHandler<RPApiKeyJwtBodyCheckResult<Body>> {
        return async data => ({ ...await this.createBodyCheck<Body>(schema)(data), ...await this.createContentApiKeyJwtCheck(roles)(data) });
    }

    static createJwtBodyCheck<Body = unknown>(
        schema: ObjectSchema,
        roles?: UserRoleName[],
    ): ControllerMethodPreRequestHandler<RPJwtBodyCheckResult<Body>> {
        const bodyCheck = this.createBodyCheck<Body>(schema);
        const jwtCheck = this.createJwtCheck(roles);
        return async (data) => {
            return {
                ...(await bodyCheck(data)),
                ...(await jwtCheck(data)),
            };
        };
    }

    static createApiKeyCheck(): ControllerMethodPreRequestHandler<RPApiKeyCheckResult> {
        return async (data) => {
            const params = data.request.params as {
                instanceId?: string;
                templateId?: string;
                entryId?: string;
                functionId?: string;
            };
            const query = data.request.query as {
                apiKey?: string;
            };
            const apiKey = await this.apiKey.verify(data.errorHandler, data.request.method,
                data.request.headers.authorization || query.apiKey, params.instanceId);
            return { apiKey, ...await verifyRequestWorkspace(data, { apiKeyId: apiKey._id, workspaceId: apiKey.workspaceId }, { templates: apiKey.access.templates }) };
        };
    }

    static createApiKeyBodyCheck<Body = unknown>(
        schema: ObjectSchema,
    ): ControllerMethodPreRequestHandler<RPApiKeyBodyCheckResult<Body>> {
        const bodyCheck = this.createBodyCheck<Body>(schema);
        const apiKeyCheck = this.createApiKeyCheck();
        return async (data) => {
            return {
                ...(await bodyCheck(data)),
                ...(await apiKeyCheck(data)),
            };
        };
    }

    static createApiKeyJwtCheck(
        roles?: UserRoleName[],
    ): ControllerMethodPreRequestHandler<RPApiKeyJwtCheckResult> {
        const apiKeyCheck = this.createApiKeyCheck();
        const jwtCheck = this.createJwtCheck(roles);
        return async (data) => {
            const query = data.request.query as {
                apiKey: string;
            };
            if (
                (data.request.headers.authorization &&
                    data.request.headers.authorization.startsWith('ApiKey')) ||
                query.apiKey
            ) {
                return apiKeyCheck(data);
            } else {
                return jwtCheck(data);
            }
        };
    }

    static createApiKeyJwtBodyCheck<Body = unknown>(
        schema: ObjectSchema,
        roles?: UserRoleName[],
    ): ControllerMethodPreRequestHandler<RPApiKeyJwtBodyCheckResult<Body>> {
        const apiKeyCheck = this.createApiKeyBodyCheck<Body>(schema);
        const jwtCheck = this.createJwtBodyCheck<Body>(schema, roles);
        return async (data) => {
            const query = data.request.query as {
                apiKey: string;
            };
            if (
                (data.request.headers.authorization &&
                    data.request.headers.authorization.startsWith('ApiKey')) ||
                query.apiKey
            ) {
                return apiKeyCheck(data);
            } else {
                return jwtCheck(data);
            }
        };
    }
}
