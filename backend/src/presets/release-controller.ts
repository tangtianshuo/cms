import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Config } from '../config';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import type { ReleaseInput, ReleaseSource, ReleaseSnapshot } from './releases';
import { buildRelease, publishRelease, releaseDiff, rollbackRelease } from './releases';

const publishBody = z.object({ expectedReleaseId: z.string() }).strict();

export function releaseSource(): ReleaseSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findDefaultFresh(),
        async loadContent(site) {
            const templates: ReleaseInput['templates'] = [];
            const entries: ReleaseInput['entries'] = [];
            for (const model of site.models) {
                const template = await Repo.template.findById(model.templateId);
                if (template) templates.push(template);
                entries.push(...await Repo.entry.methods.findAllByTemplateId(model.templateId));
            }
            return { templates, entries, media: await Repo.media.findAll(),
                language: Config.storefrontLanguage, currency: Config.storefrontCurrency,
                mediaOrigin: Config.storefrontMediaOrigin };
        },
        findRelease: (id) => Repo.storefrontRelease.findById(id),
        async insertRelease(record) { await Repo.storefrontRelease.add(record, true); },
        activate: (site, releaseId) => Repo.siteInstallation.methods.activate(site, releaseId),
        async audit(event) { await Repo.storefrontReleaseAudit.add(event, true); },
    };
}

export const ReleaseController = createController({
    name: 'StorefrontReleases',
    path: '/api/v4/presets/releases',
    methods() {
        return {
            history: createControllerMethod({
                path: '/', type: 'get', preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const site = await Repo.siteInstallation.methods.findDefaultFresh();
                    if (!site) return { currentReleaseId: '', items: [], audit: [] };
                    const published = site.publishedReleaseIds || [site.currentReleaseId];
                    const records = await Repo.storefrontRelease.methods.findBySite(site._id);
                    return { currentReleaseId: site.currentReleaseId || '',
                        items: records.filter((record) => published.includes(record._id)).map((record) => ({
                            _id: record._id, createdAt: record.createdAt, createdBy: record.createdBy,
                            pageCount: (JSON.parse(record.payload) as ReleaseSnapshot).pages.length,
                        })), audit: await Repo.storefrontReleaseAudit.methods.findBySite(site._id) };
                },
            }),
            check: createControllerMethod({
                path: '/check', type: 'post', preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const source = releaseSource();
                    const site = await source.findSite();
                    try {
                        if (!Config.storefrontEnabled) throw new Error('Storefront is disabled');
                        if (!site) throw new Error('Site is not installed');
                        const current = site.currentReleaseId ? await source.findRelease(site.currentReleaseId) : null;
                        if (current && current.siteId !== site._id) throw new Error('Release belongs to another site');
                        const previous = current ? JSON.parse(current.payload) as ReleaseSnapshot : undefined;
                        const snapshot = buildRelease({ ...await source.loadContent(site), site, previous });
                        return { valid: true, issues: [], expectedReleaseId: site.currentReleaseId || '',
                            pageCount: snapshot.pages.length, diff: releaseDiff(previous, snapshot) };
                    } catch (cause) {
                        return { valid: false, issues: [cause instanceof Error ? cause.message : 'Validation failed'],
                            expectedReleaseId: site?.currentReleaseId || '', pageCount: 0, diff: null };
                    }
                },
            }),
            publish: createControllerMethod({
                path: '/publish', type: 'post', preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.safeParse(request.body);
                    if (!parsed.success || !Config.storefrontEnabled) throw errorHandler(HttpStatus.BadRequest, 'Invalid publication request or storefront disabled');
                    try {
                        const record = await publishRelease(releaseSource(), token.payload.userId, parsed.data.expectedReleaseId);
                        return { releaseId: record._id };
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Publication failed');
                    }
                },
            }),
            rollback: createControllerMethod({
                path: '/rollback', type: 'post', preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.extend({ releaseId: z.string().min(1) }).safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid rollback request');
                    try {
                        await rollbackRelease(releaseSource(), token.payload.userId, parsed.data.releaseId, parsed.data.expectedReleaseId);
                        return { releaseId: parsed.data.releaseId };
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Rollback failed');
                    }
                },
            }),
        };
    },
});
