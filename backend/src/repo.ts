import { SiteDomainRepo, SiteDomainAuditRepo } from './site-domains/repo';
import { UserRepo } from '@bcms/selfhosted-backend/user/repo';
import { ApiKeyRepo } from '@bcms/selfhosted-backend/api-key/repo';
import { MediaRepo } from '@bcms/selfhosted-backend/media/repo';
import { GroupRepo } from '@bcms/selfhosted-backend/group/repo';
import { WidgetRepo } from '@bcms/selfhosted-backend/widget/repo';
import { TemplateRepo } from '@bcms/selfhosted-backend/template/repo';
import { EntryRepo } from '@bcms/selfhosted-backend/entry/repo';
import { LanguageRepo } from '@bcms/selfhosted-backend/language/repo';
import { EntryStatusRepo } from '@bcms/selfhosted-backend/entry-status/repo';
import { TemplateOrganizerRepo } from '@bcms/selfhosted-backend/template-organizer/repo';
import { BackupRepo } from '@bcms/selfhosted-backend/backup/repo';
import { SiteInstallationRepo } from '@bcms/selfhosted-backend/presets/site-repo';
import { ReleaseRepo, ReleaseAuditRepo } from '@bcms/selfhosted-backend/presets/release-repo';

export class Repo {
    static readonly siteDomain = SiteDomainRepo;
    static readonly siteDomainAudit = SiteDomainAuditRepo;
    static readonly user = UserRepo;
    static readonly apiKey = ApiKeyRepo;
    static readonly media = MediaRepo;
    static readonly group = GroupRepo;
    static readonly widget = WidgetRepo;
    static readonly template = TemplateRepo;
    static readonly templateOrganizer = TemplateOrganizerRepo;
    static readonly entry = EntryRepo;
    static readonly language = LanguageRepo;
    static readonly entryStatus = EntryStatusRepo;
    static readonly backup = BackupRepo;
    static readonly siteInstallation = SiteInstallationRepo;
    static readonly storefrontRelease = ReleaseRepo;
    static readonly storefrontReleaseAudit = ReleaseAuditRepo;
}
