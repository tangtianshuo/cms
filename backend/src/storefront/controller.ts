import { workspaceContext } from '../workspaces/context';
import { z } from 'zod';
import {
    createController,
    createControllerMethod,
    HttpStatus,
} from '../_server';
import { RP } from '../security/route-protection/main';
import { Repo } from '../repo';
import { Config } from '../config';
import type { Entry } from '../entry/models/main';
import { getProductPage, previewProductPage, type DevelopmentSite } from './service';
import { previewPresetPage } from './preset-preview';
import { publishedSite, publishedDomainSite } from './published';
import { trustedStorefrontHost } from '../site-domains/trust';
import { domainService } from '../site-domains/source';

const previewBodySchema = z.object({
    entry: z.object({
        templateId: z.string().min(1),
        meta: z.array(z.object({
            lng: z.string(),
            props: z.array(z.object({ id: z.string(), data: z.unknown() }).passthrough()),
        }).passthrough()),
    }).passthrough(),
    config: z.unknown().optional(),
}).strict();

const pagePreviewBodySchema = z.object({
    entry: previewBodySchema.shape.entry,
    pageKey: z.string().min(1),
    language: z.string().min(1),
}).strict();

function siteConfig(): DevelopmentSite {
    return {
        name: Config.storefrontSiteName,
        host: Config.storefrontHost,
        language: Config.storefrontLanguage,
        currency: Config.storefrontCurrency,
        mediaOrigin: Config.storefrontMediaOrigin,
    };
}

export const StorefrontController = createController({
    name: 'Storefront',
    path: '/api/v4/storefront',
    methods() {
        return {
            published: createControllerMethod({
                type: 'get', path: '/published',
                async handler({ request, reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    if (!Config.storefrontEnabled) throw errorHandler(HttpStatus.NotFound, 'Storefront is disabled');
                    const host = trustedStorefrontHost(request.headers, { secret: Config.storefrontGatewaySecret, localHost: Config.storefrontHost, production: Config.storefrontProduction });
                    if (!host) throw errorHandler(HttpStatus.NotFound, 'Published site not found');
                    const local = !Config.storefrontProduction && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && host === Config.storefrontHost;
                    const snapshot = local ? await publishedSite(host, Config.storefrontHost, {
                        findSite: () => Repo.siteInstallation.methods.findDefaultFresh(),
                        findRelease: (id) => Repo.storefrontRelease.findById(id),
                    }).then((result) => result ? { ...result, primaryHostname: host, bindingRevision: 0 } : null) : await publishedDomainSite(host, {
                        resolve: (hostname) => domainService().resolve(hostname),
                        findSiteById: (id) => Repo.siteInstallation.methods.findFresh(id),
                        findRelease: (id) => Repo.storefrontRelease.findById(id),
                    });
                    if (!snapshot) throw errorHandler(HttpStatus.NotFound, 'Published site not found');
                    const path = (request.query as { path?: unknown }).path;
                    if (path === undefined) return { releaseId: snapshot.releaseId, language: snapshot.language, primaryHostname: snapshot.primaryHostname, bindingRevision: snapshot.bindingRevision, origin: `${local ? 'http' : 'https'}://${snapshot.primaryHostname}`,
                        paths: snapshot.pages.map((page) => page.path) };
                    if (typeof path !== 'string') throw errorHandler(HttpStatus.BadRequest, 'Invalid path');
                    const page = snapshot.pages.find((item) => item.path === path);
                    const redirect = snapshot.redirects.find((item) => item.from === path);
                    if (!page && !redirect) throw errorHandler(HttpStatus.NotFound, 'Published page not found');
                    return { releaseId: snapshot.releaseId, language: snapshot.language, primaryHostname: snapshot.primaryHostname, bindingRevision: snapshot.bindingRevision, origin: `${local ? 'http' : 'https'}://${snapshot.primaryHostname}`,
                        path, content: page?.content, redirect: redirect?.to, navigation: snapshot.navigation };
                },
            }),
            product: createControllerMethod({
                type: 'get',
                path: '/products/:slug',
                async handler({ request, reply, errorHandler }) {
                    if (!Config.storefrontEnabled) {
                        throw errorHandler(HttpStatus.NotFound, 'Storefront is disabled');
                    }
                    if (await Repo.siteInstallation.methods.findDefaultFresh()) {
                        throw errorHandler(HttpStatus.NotFound, 'Use the published storefront route');
                    }
                    const { slug } = request.params as { slug: string };
                    const host = request.headers['x-storefront-host'];
                    const page = await getProductPage(
                        slug,
                        typeof host === 'string' ? host : '',
                        siteConfig(),
                        {
                            findTemplate: () => Repo.template.methods.findByName('product'),
                            findEntries: (templateId) => Repo.entry.methods.findAllByTemplateId(templateId),
                            findMedia: () => Repo.media.findAll(),
                        },
                    );
                    if (!page) {
                        throw errorHandler(HttpStatus.NotFound, 'Product not found');
                    }
                    reply.header('Cache-Control', 'no-store');
                    return page;
                },
            }),
            preview: createControllerMethod({
                type: 'post',
                path: '/preview',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler({ request, reply, errorHandler, token }) {
                    if (!Config.storefrontEnabled) {
                        throw errorHandler(HttpStatus.NotFound, 'Storefront is disabled');
                    }
                    const parsed = previewBodySchema.safeParse(request.body);
                    if (!parsed.success) {
                        throw errorHandler(HttpStatus.BadRequest, 'Invalid preview request');
                    }
                    const selectedSite = await Repo.siteInstallation.methods.findSelected();
                    const productId = selectedSite?.models.find(model => model.key === 'product')?.templateId;
                    const template = productId ? await Repo.template.findById(productId) : await Repo.template.methods.findByName('product');
                    if (!template || parsed.data.entry.templateId !== template._id) {
                        throw errorHandler(HttpStatus.BadRequest, 'Entry is not a product');
                    }
                    const roles = token.payload.rls;
                    const policy = token.payload.props?.policy?.templates.find((item) => item._id === template._id);
                    if (!workspaceContext()?.admin && !roles.includes('ADMIN') && !roles.includes('SUDO') && !policy?.get) {
                        throw errorHandler(HttpStatus.Forbidden, 'Product access denied');
                    }
                    try {
                        const page = await previewProductPage(
                            parsed.data.entry as unknown as Entry,
                            siteConfig(),
                            template,
                            await Repo.media.findAll(),
                            parsed.data.config,
                        );
                        reply.header('Cache-Control', 'no-store');
                        reply.header('X-Robots-Tag', 'noindex');
                        return page;
                    } catch (error) {
                        throw errorHandler(HttpStatus.BadRequest, (error as Error).message);
                    }
                },
            }),
            pagePreview: createControllerMethod({
                type: 'post',
                path: '/page-preview',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler({ request, reply, errorHandler, token }) {
                    if (!Config.storefrontEnabled) {
                        throw errorHandler(HttpStatus.NotFound, 'Storefront is disabled');
                    }
                    const parsed = pagePreviewBodySchema.safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid page preview request');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!site || site.status !== 'ready') {
                        throw errorHandler(HttpStatus.NotFound, 'No installed site');
                    }
                    const entry = parsed.data.entry as unknown as Entry;
                    const selectedModel = site.models.find((model) => model.templateId === entry.templateId);
                    if (!selectedModel) throw errorHandler(HttpStatus.BadRequest, 'Entry is outside the installed site');
                    const elevated = !!workspaceContext()?.admin;
                    const canRead = (templateId: string) => elevated || Boolean(
                        token.payload.props?.policy?.templates.find((item) => item._id === templateId)?.get,
                    );
                    if (!canRead(entry.templateId)) {
                        throw errorHandler(HttpStatus.Forbidden, 'Entry access denied');
                    }
                    const relatedEntries: Entry[] = [];
                    for (const model of site.models) {
                        if (canRead(model.templateId)) {
                            relatedEntries.push(...await Repo.entry.methods.findAllByTemplateId(model.templateId));
                        }
                    }
                    try {
                        const page = previewPresetPage({
                            site, pageKey: parsed.data.pageKey, entry,
                            language: parsed.data.language,
                            availableLanguages: (await Repo.language.findAll()).map((item) => item.code),
                            relatedEntries,
                            media: await Repo.media.findAll(),
                            mediaOrigin: siteConfig().mediaOrigin,
                            currency: siteConfig().currency,
                        });
                        reply.header('Cache-Control', 'no-store');
                        reply.header('X-Robots-Tag', 'noindex');
                        return page;
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest,
                            cause instanceof Error ? cause.message : 'Invalid page preview');
                    }
                },
            }),
        };
    },
});
