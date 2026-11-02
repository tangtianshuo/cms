import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import type { MongoDBEntry } from '../_server/modules/mongodb';

export interface AnalyticsEvent extends MongoDBEntry { siteId: string; releaseId?: string; eventType: string; path: string; referrer?: string; device?: string; visitorHash?: string; sessionHash?: string }
export const AnalyticsRepo = createMongoDBRepository<AnalyticsEvent>({ name: 'AnalyticsEvent', collection: `${Config.storageScope}_analytics_events`, workspaceScoped: false, schema: { _id: { __type: 'string', __required: true }, createdAt: { __type: 'number', __required: true }, updatedAt: { __type: 'number', __required: true }, siteId: { __type: 'string', __required: true }, eventType: { __type: 'string', __required: true }, path: { __type: 'string', __required: true } }, indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'analytics_by_site' }] });
