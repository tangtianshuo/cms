/** An address is never an authorization grant. Resolve it against SDK-loaded context first. */
export interface EditorTarget {
    intent: 'create' | 'edit' | 'page';
    workspaceId: string;
    siteId?: string;
    templateId: string;
    modelKey?: string;
    entryId: string | null;
    pageKey?: string;
    language: string;
    groupId?: string;
}
export function contentEditorLocation(target: EditorTarget): { path: '/d/studio'; query: Record<string, string> } {
    const query: Record<string, string> = { section: 'content', intent: target.intent, workspaceId: target.workspaceId, templateId: target.templateId, language: target.language };
    if (target.intent === 'create') query.entryId = 'create';
    else if (target.entryId) query.entryId = target.entryId;
    if (target.siteId) query.siteId = target.siteId;
    if (target.modelKey) query.modelKey = target.modelKey;
    if (target.pageKey) query.pageKey = target.pageKey;
    if (target.groupId) query.group = target.groupId;
    return { path: '/d/studio', query };
}
export interface EditorContext {
    workspaceId: string; siteId?: string; language: string; languages: string[];
    models: Array<{ key: string; templateId: string; singleEntry: boolean; entries: Array<{ id: string }> }>;
    pages: Array<{ key: string; modelKey: string; entryId: string }>;
}
export function resolveEditorTarget(query: Record<string, unknown>, context: EditorContext): EditorTarget {
    const value = (key: string) => {
        const raw = query[key];
        if (raw !== undefined && typeof raw !== 'string') throw new Error('内容地址无效。');
        return raw as string | undefined;
    };
    const workspaceId = value('workspaceId'); const siteId = value('siteId');
    if ((workspaceId && workspaceId !== context.workspaceId) || (siteId && siteId !== context.siteId)) throw new Error('目标不属于当前网站，请先选择对应网站。');
    const language = value('language') || context.language;
    if (!context.languages.includes(language)) throw new Error('当前网站没有此语言内容。');
    const pageKey = value('pageKey'); const requestedModel = value('modelKey'); const templateId = value('templateId');
    const page = pageKey ? context.pages.find(item => item.key === pageKey) : undefined;
    if (pageKey && !page) throw new Error('目标页面不存在，或当前网站没有此页面。');
    const model = context.models.find(item => (requestedModel ? item.key === requestedModel : templateId ? item.templateId === templateId : item.key === page?.modelKey));
    if ((!model && (!page || templateId || requestedModel)) || (page && model && model.key !== page.modelKey) || (model && templateId && model.templateId !== templateId) || (page && requestedModel && page.modelKey !== requestedModel)) throw new Error('目标内容模型不存在，或你没有访问权限。');
    const requestedEntry = value('entryId'); const declaredIntent = value('intent');
    if (declaredIntent && !['create', 'edit', 'page'].includes(declaredIntent)) throw new Error('内容地址无效。');
    const bound = page && model ? model.entries.find(item => item.id === page.entryId) || (model.singleEntry && !page.entryId ? model.entries[0] : undefined) : undefined;
    const entryId = requestedEntry === 'create' ? null : requestedEntry || bound?.id || (model?.singleEntry && !page ? model.entries[0]?.id : null) || null;
    const intent = declaredIntent || (requestedEntry === 'create' ? 'create' : entryId ? 'edit' : page ? 'page' : model?.singleEntry ? 'create' : '');
    if (!intent || (intent === 'create' && (entryId || page)) || (intent === 'edit' && !entryId) || (intent === 'page' && requestedEntry) || (entryId && !model?.entries.some(item => item.id === entryId)) || (page && requestedEntry && bound?.id !== requestedEntry)) throw new Error('目标内容不存在，或你没有访问权限。');
    return { intent: intent as EditorTarget['intent'], workspaceId: context.workspaceId, siteId: context.siteId, templateId: model?.templateId || '', modelKey: model?.key, entryId: intent === 'page' ? null : entryId, pageKey, language, groupId: value('group') };
}
