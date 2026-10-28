import type { AxiosError, AxiosRequestConfig } from 'axios';
import type { ScopeSelection, SelectedContext } from './context';
import axios from 'axios';
import { Buffer } from 'buffer';
import type { UserJwt } from '@bcms/selfhosted-backend/user/models/main';
import { createQueue, QueueError } from '@bcms/selfhosted-utils/queue';
import { SocketHandler } from '@bcms/selfhosted-sdk/handlers/socket';
import type { SdkStore } from '@bcms/selfhosted-sdk/store';
import type { SdkStorage } from '@bcms/selfhosted-sdk/storage';
import { AuthHandler } from '@bcms/selfhosted-sdk/handlers/auth';
import { UserHandler } from '@bcms/selfhosted-sdk/handlers/user';
import { TemplateHandler } from '@bcms/selfhosted-sdk/handlers/template';
import { GroupHandler } from '@bcms/selfhosted-sdk/handlers/group';
import { WidgetHandler } from '@bcms/selfhosted-sdk/handlers/widget';
import { MediaHandler } from '@bcms/selfhosted-sdk/handlers/media';
import { LanguageHandler } from '@bcms/selfhosted-sdk/handlers/language';
import { EntryHandler } from '@bcms/selfhosted-sdk/handlers/entry';
import { EntryStatusHandler } from '@bcms/selfhosted-sdk/handlers/entry-status';
import { BackupHandler } from '@bcms/selfhosted-sdk/handlers/backup';
import { ApiKeyHandler } from '@bcms/selfhosted-sdk/handlers/api-key';
import { FunctionHandler } from '@bcms/selfhosted-sdk/handlers/functions';
import { TemplateOrganizerHandler } from '@bcms/selfhosted-sdk/handlers/template-organizer';
import { StudioHandler } from './handlers/studio';
import { PluginHandler } from '@bcms/selfhosted-sdk/handlers/plugin';
import { TypeGeneratorHandler } from '@bcms/selfhosted-sdk/handlers/type-generator';

export interface SdkConfig {
    apiOrigin: string;
    ignoreSocket?: boolean;
    debug?: Array<'all' | 'socket'>;
}

/**
 * SDK class for interacting with the Backend API.
 */
export class Sdk {
    /**
     * Access token in raw format <b64.b64.signature>
     */
    accessTokenRaw: string | null = null;
    /**
     * Unpacked access token
     */
    accessToken: UserJwt | null = null;

    context: SelectedContext | null = null;
    private scopeEpoch = 0;
    private scopeChanging = false;
    private contextPromise?: Promise<SelectedContext>;

    async ensureContext(): Promise<SelectedContext> {
        if (this.context) return this.context;
        if (!this.contextPromise)
            this.contextPromise = (async () => {
                const selected = this.storage.get<ScopeSelection>(
                    'selection',
                ) || { workspaceId: 'default' };
                const result = await this.send<SelectedContext>({
                    url: '/api/v4/workspaces/current',
                    selectorOverride: selected,
                });
                if (result.context.siteId) {
                    const sites = await this.send<{
                        items: import('@bcms/selfhosted-backend/presets/site-model').SiteInstallation[];
                    }>({
                        url: '/api/v4/workspaces/current/sites',
                        selectorOverride: selected,
                    });
                    result.site = sites.items.find(
                        (site) => site._id === result.context.siteId,
                    );
                }
                this.context = result;
                return result;
            })();
        try {
            return await this.contextPromise;
        } catch (error) {
            this.contextPromise = undefined;
            throw error;
        }
    }

    /** Validate first, then retire this entire SDK generation before navigating. */
    async selectContext(selection: ScopeSelection, destination = '/d/presets') {
        await this.send<SelectedContext>({
            url: '/api/v4/workspaces/current',
            selectorOverride: selection,
        });
        if (!(await this.storage.set('selection', selection)))
            throw new Error('Could not save workspace selection');
        this.scopeChanging = true;
        this.scopeEpoch++;
        this.socket.clear();
        for (const value of Object.values(this.store)) {
            if (
                value &&
                typeof value.items === 'function' &&
                typeof value.remove === 'function'
            )
                value.remove(
                    value.items().map((item: { _id: string }) => item._id),
                );
        }
        this.context = null;
        window.location.assign(destination);
    }

    private refreshQueue = createQueue<boolean>();

    socket = new SocketHandler(this);
    auth = new AuthHandler(this);
    user = new UserHandler(this);
    group = new GroupHandler(this);
    template = new TemplateHandler(this);
    templateOrganizer = new TemplateOrganizerHandler(this);
    widget = new WidgetHandler(this);
    media = new MediaHandler(this);
    apiKey = new ApiKeyHandler(this);
    language = new LanguageHandler(this);
    entry = new EntryHandler(this);
    entryStatus = new EntryStatusHandler(this);
    typeGenerator = new TypeGeneratorHandler(this);
    fn = new FunctionHandler(this);
    backup = new BackupHandler(this);
    plugin = new PluginHandler(this);
    studio = new StudioHandler(this);

    constructor(
        public store: SdkStore,
        public storage: SdkStorage,
        public config: SdkConfig,
    ) {
        if (!config.apiOrigin) {
            config.apiOrigin = '';
        }
        this.accessTokenRaw = this.storage.get('at');
        if (this.accessTokenRaw) {
            this.accessToken = this.unpackAccessToken(this.accessTokenRaw);
        }
        this.storage.subscribe<string>('at', (value, type) => {
            if (type === 'set') {
                this.accessTokenRaw = value;
                if (this.accessTokenRaw) {
                    this.accessToken = this.unpackAccessToken(
                        this.accessTokenRaw,
                    );
                }
            } else {
                this.accessTokenRaw = null;
                this.accessToken = null;
            }
        });
        this.socket.register('refresh', async () => {
            await this.refreshAccessToken(true);
        });
    }

    unpackAccessToken(at: string): UserJwt | null {
        const atParts = at.split('.');
        if (atParts.length === 3) {
            return {
                header: JSON.parse(
                    Buffer.from(atParts[0], 'base64').toString(),
                ),
                payload: JSON.parse(
                    Buffer.from(atParts[1], 'base64').toString(),
                ),
                signature: atParts[2],
            };
        }
        return null;
    }

    public async clear() {
        this.scopeEpoch++;
        this.context = null;
        this.contextPromise = undefined;
        this.accessToken = null;
        this.accessTokenRaw = null;
        await this.storage.clear();
        for (const _key in this.store) {
            const key = _key as keyof SdkStore;
            (this.store as any)[key].remove(
                (this.store as any)[key].items().map((e: any) => e._id),
            );
        }
        this.auth.clear();
        this.user.clear();
        this.group.clear();
        this.widget.clear();
        this.template.clear();
        this.templateOrganizer.clear();
        this.media.clear();
        this.apiKey.clear();
        this.language.clear();
        this.entry.clear();
        this.entryStatus.clear();
        this.typeGenerator.clear();
        this.backup.clear();
        this.fn.clear();
        this.plugin.clear();
        this.socket.clear();
        window.location.hash = `/?forward=${encodeURIComponent(
            window.location.pathname,
        )}`;
    }

    public async refreshAccessToken(force?: boolean): Promise<boolean> {
        const result = await this.refreshQueue({
            name: 'refresh',
            handler: async () => {
                if (!force) {
                    let refresh = true;
                    if (this.accessToken) {
                        if (
                            this.accessToken.payload.iat +
                                this.accessToken.payload.exp >
                            Date.now() + 1000
                        ) {
                            refresh = false;
                        }
                    } else {
                        this.accessTokenRaw = this.storage.get<string>('at');
                        if (this.accessTokenRaw) {
                            this.accessToken = this.unpackAccessToken(
                                this.accessTokenRaw,
                            );
                            if (
                                this.accessToken &&
                                this.accessToken.payload.iat +
                                    this.accessToken.payload.exp >
                                    Date.now()
                            ) {
                                refresh = false;
                            }
                        }
                    }
                    if (!refresh) {
                        return true;
                    }
                }
                const refreshToken = this.storage.get('rt');
                if (!refreshToken) {
                    return false;
                }
                try {
                    const res = await this.send<{ accessToken: string }>({
                        url: '/api/v4/auth/refresh-access',
                        doNotAuth: true,
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${this.storage.get('rt')}`,
                        },
                        data: {},
                    });
                    this.accessToken = this.unpackAccessToken(res.accessToken);
                    await this.storage.set('at', res.accessToken);
                    return true;
                } catch (error) {
                    console.error(error);
                    const err = error as AxiosError;
                    if (
                        err.response?.status === 401 ||
                        err.response?.status === 403
                    ) {
                        await this.clear();
                    }
                    return false;
                }
            },
        }).wait;
        if (result instanceof QueueError) {
            throw result.error;
        }
        return result.data;
    }

    public async isLoggedIn(): Promise<boolean> {
        const result = await this.refreshAccessToken();
        if (
            result &&
            this.context &&
            !this.scopeChanging &&
            !this.socket.connected &&
            !this.config.ignoreSocket
        ) {
            try {
                await this.socket.connect();
            } catch (error) {
                console.error(error);
            }
        }
        return result;
    }

    public async send<Result = unknown>(
        conf: AxiosRequestConfig & {
            doNotAuth?: boolean;
            selectorOverride?: ScopeSelection;
        },
    ): Promise<Result> {
        const epoch = this.scopeEpoch;
        if (this.scopeChanging)
            throw new Error('Workspace selection is changing');
        const selection =
            conf.selectorOverride ||
            (this.context
                ? {
                      workspaceId: this.context.context.workspaceId,
                      siteId: this.context.context.siteId,
                  }
                : undefined);
        if (!conf.headers) {
            conf.headers = {};
        }
        if (!conf.doNotAuth) {
            const loggedIn = await this.isLoggedIn();
            conf.headers.Authorization = `Bearer ${this.accessTokenRaw}`;
            if (!loggedIn || !this.accessTokenRaw) {
                throw {
                    status: 401,
                    message: 'Not logged in.',
                };
            }
        }
        if (!conf.doNotAuth && selection) {
            conf.headers['x-bcms-workspace'] = selection.workspaceId;
            if (selection.siteId)
                conf.headers['x-bcms-site'] = selection.siteId;
        }
        if (epoch !== this.scopeEpoch || this.scopeChanging)
            throw new Error('Workspace selection changed');
        delete conf.selectorOverride;
        conf.url = `${this.config.apiOrigin}${conf.url}`;
        if (this.socket.id) {
            conf.headers['X-Bcms-Sid'] = this.socket.id;
        }
        try {
            conf.maxBodyLength = 100000000;
            const response = await axios(conf);
            if (epoch !== this.scopeEpoch || this.scopeChanging)
                throw new Error('Workspace selection changed');
            return response.data;
        } catch (error) {
            const err = error as AxiosError<{
                message: string;
                code: string;
            }>;
            if (err.response) {
                console.error(err);
                if (err.response.data && err.response.data.message) {
                    throw {
                        status: err.response.status,
                        code: err.response.data.code,
                        message: err.response.data.message,
                    };
                } else {
                    throw {
                        status: err.response.status,
                        code: '-1',
                        message: err.message,
                    };
                }
            } else {
                throw {
                    status: -1,
                    code: '-1',
                    message: err.message,
                };
            }
        }
    }
}

export function createSdk(
    store: SdkStore,
    storage: SdkStorage,
    config: SdkConfig,
) {
    return new Sdk(store, storage, config);
}
