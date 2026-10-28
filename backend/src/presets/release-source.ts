import { Repo } from '../repo';
import { Config } from '../config';
import type { ReleaseInput } from './releases';
import type { GatewayReleaseSource } from './gateway-publish';

export function releaseSource(): GatewayReleaseSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findSelected(),
        async loadContent(site) {
            const templates: ReleaseInput['templates'] = [];
            const entries: ReleaseInput['entries'] = [];
            for (const model of site.models) {
                const template = await Repo.template.findById(model.templateId);
                if (template) templates.push(template);
                entries.push(...await Repo.entry.methods.findAllByTemplateId(model.templateId));
            }
            return { templates, entries, media: await Repo.media.findAll(),
                language: site.language || Config.storefrontLanguage, currency: Config.storefrontCurrency,
                mediaOrigin: Config.storefrontMediaOrigin };
        },
        findRelease: (id) => Repo.storefrontRelease.findById(id),
        async insertRelease(record) { await Repo.storefrontRelease.add(record, true); },
        activate: (site, releaseId) => Repo.siteInstallation.methods.activate(site, releaseId),
        projectGatewayRelease: (site, releaseId, revision) => Repo.siteInstallation.methods.projectGatewayRelease(site, releaseId, revision),
        saveSite: (site, expectedUpdatedAt) => Repo.siteInstallation.methods.saveDraft(site, expectedUpdatedAt),
        async audit(event) { await Repo.storefrontReleaseAudit.methods.record(event); },
    };
}
