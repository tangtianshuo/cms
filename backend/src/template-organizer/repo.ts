import { Repo } from '../repo';
import { ContentScopeError } from '../workspaces/scoped-collection';
import { createMongoDBRepository } from '@bcms/selfhosted-backend/_server/modules/mongodb';
import { Config } from '@bcms/selfhosted-backend/config';
import {
    type TemplateOrganizer,
    TemplateOrganizerSchema,
} from '@bcms/selfhosted-backend/template-organizer/models/main';

export const TemplateOrganizerRepo = createMongoDBRepository<
    TemplateOrganizer,
    void
>({
    name: 'TemplateOrganizerRepo',
    collection: `${Config.storageScope}_template_organizers`,
    schema: TemplateOrganizerSchema,
    async prepareWrite(item) {
        for (const id of item.templateIds) if (!await Repo.template.findById(id)) throw new ContentScopeError('Template reference not found in workspace');
        const seen = new Set([item._id]); let parentId = item.parentId;
        while (parentId) {
            if (seen.has(parentId)) throw new ContentScopeError('Template organizer cycle is not permitted');
            seen.add(parentId); const parent = await Repo.templateOrganizer.findById(parentId);
            if (!parent) throw new ContentScopeError('Template organizer parent not found in workspace');
            parentId = parent.parentId;
        }
    },
});
