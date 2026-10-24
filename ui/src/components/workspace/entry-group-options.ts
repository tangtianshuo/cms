import type { EntryGroup } from '@bcms/selfhosted-backend/entry-groups/repo';

export interface EntryGroupList {
    items: EntryGroup[];
    defaultGroupId: string;
}

export type EntryGroupOption = Pick<EntryGroup, '_id' | 'name'>;

export function entryGroupOptions(
    result: EntryGroupList,
    defaultName: string,
): EntryGroupOption[] {
    if (result.items.some((group) => group._id === result.defaultGroupId)) {
        return result.items;
    }
    return [
        { _id: result.defaultGroupId, name: defaultName },
        ...result.items,
    ];
}
