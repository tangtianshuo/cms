import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
export function normalizedTitle(value: string) { return value.normalize('NFKC').trim().toLowerCase(); }
export function entryTitleKeys(entry: Entry, template: Template | null): string[] {
    const title = template?.props.find(prop => prop.name === 'title');
    if (!title) return [];
    const languages = new Set<string>();
    return (entry.meta || []).map(meta => {
        if (languages.has(meta.lng)) throw new Error('Duplicate entry language');
        languages.add(meta.lng);
        const value = meta.props.find(prop => prop.id === title.id)?.data;
        if (!Array.isArray(value) || typeof value[0] !== 'string') throw new Error('Entry title must be a string');
        return JSON.stringify([meta.lng, normalizedTitle(value[0])]);
    });
}
