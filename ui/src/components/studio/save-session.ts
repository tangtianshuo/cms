export interface SaveContext { entryId?: string; entryUpdatedAt?: number; siteUpdatedAt: number }
export interface SavePart { key: 'content' | 'page' | 'settings'; confirms: Array<'content' | 'page' | 'settings'>; run: (context: SaveContext) => Promise<SaveContext> }
/** Each receipt belongs only to its request. Never read a later shared version. */
export async function saveSession(parts: SavePart[], initial: SaveContext): Promise<{ context: SaveContext; completed: SavePart['key'][]; failed?: { key: SavePart['key']; error: unknown } }> {
    let context = initial;
    const completed: SavePart['key'][] = [];
    for (const part of parts) {
        try { context = await part.run(context); completed.push(...part.confirms); }
        catch (error) { return { context, completed, failed: { key: part.key, error } }; }
    }
    return { context, completed };
}
