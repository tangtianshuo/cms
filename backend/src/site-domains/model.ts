import type { MongoDBEntry } from '../_server/modules/mongodb';
export interface SiteDomain extends MongoDBEntry {
    siteId: string;
    hostname: string;
    enabled: boolean;
    ownershipStatus: 'pending' | 'verified';
    connectionStatus: 'unchecked' | 'ready' | 'error';
    verificationTokenHash: string;
    verificationExpiresAt: number;
    verifiedAt: number;
    lastCheckedAt: number;
    lastSuccessAt: number;
    dnsReady: boolean;
    lastError: string;
}
export interface DomainSite { _id: string; primaryDomainId?: string; domainRevision?: number }
export interface DomainAudit extends MongoDBEntry { siteId: string; actorId: string; domainId: string; operation: string; error: string }
export interface DomainPrimaryAudit extends DomainAudit { operation: 'primary'; outcome: 'committed'; bindingRevision: number }
export interface DomainResolution { siteId: string; hostname: string; primaryHostname: string; bindingRevision: number }
