import type { MongoDBEntry } from '../_server/modules/mongodb';
import type { ObjectSchema } from '../_utils/object-utility';
import { MongoDBEntrySchema } from '../_server/modules/mongodb/entry';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'spam';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'disabled';

export interface Lead extends MongoDBEntry {
    siteId: string;
    source: string;
    schemaVersion: number;
    name?: string;
    email?: string;
    phone?: string;
    message?: string;
    fields: Record<string, string>;
    status: LeadStatus;
    assignedTo?: string;
    notes?: string;
    notificationStatus: NotificationStatus;
    notificationError?: string;
}

export const LeadSchema: ObjectSchema = {
    ...MongoDBEntrySchema,
    siteId: { __type: 'string', __required: true },
    source: { __type: 'string', __required: true },
    schemaVersion: { __type: 'number', __required: true },
    name: { __type: 'string', __required: false },
    email: { __type: 'string', __required: false },
    phone: { __type: 'string', __required: false },
    message: { __type: 'string', __required: false },
    fields: { __type: 'object', __required: true, __child: { __content: {} } },
    status: { __type: 'string', __required: true },
    assignedTo: { __type: 'string', __required: false },
    notes: { __type: 'string', __required: false },
    notificationStatus: { __type: 'string', __required: true },
    notificationError: { __type: 'string', __required: false },
};
