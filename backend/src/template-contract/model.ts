export type EditorControl = 'text' | 'number' | 'boolean' | 'date' | 'enum' | 'media' | 'reference' | 'rich-text' | 'array' | 'widget';

export interface TemplateEditorField {
    key: string;
    label: string;
    control: EditorControl;
    group?: string;
    description?: string;
    default?: unknown;
    options?: string[];
    required?: boolean;
    visibleWhen?: { field: string; equals: unknown };
}

export interface TemplateSectionProperty {
    control: EditorControl; required?: boolean; label?: string; description?: string; default?: unknown; options?: string[];
    visibleWhen?: { field: string; equals: unknown };
    minimum?: number; integer?: boolean;
}

export interface TemplateEditorContract {
    schemaVersion: 1;
    models: Array<{ modelKey: string; fields: TemplateEditorField[] }>;
    pages: Array<{ pageKey: string; modelKey: string; pathRule: { type: 'fixed' | 'pattern'; value: string }; allowNavigation: boolean; sections: string[] }>;
    sections: Array<{ type: string; label: string; description?: string; allowedPages: string[]; singleton: boolean; required: boolean; props: Record<string, TemplateSectionProperty> }>;
    operations: { canCreatePages: boolean; canEditNavigation: boolean; canPublish: boolean };
}

export interface TemplateRendererContract {
    contractVersion: 1;
    templateId: string;
    templateVersion: string;
    preview: { protocolVersion: 1; capabilities: string[] };
    assets: { mode: 'published' | 'embedded'; basePath: string };
}

export interface TemplateCompatibility {
    cmsSchema: 1;
    releaseSchema: 1;
    migrations: Array<{ from: string; to: string; steps: Array<Record<string, unknown>> }>;
}

export function validateTemplateContract(value: unknown, identity: { id: string; version: string }): { editor: TemplateEditorContract; renderer: TemplateRendererContract; compatibility: TemplateCompatibility } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Template contract is invalid');
    const input = value as Record<string, unknown>;
    const editor = input.editor as TemplateEditorContract | undefined;
    const renderer = input.renderer as TemplateRendererContract | undefined;
    const compatibility = input.compatibility as TemplateCompatibility | undefined;
    if (!editor || editor.schemaVersion !== 1 || !Array.isArray(editor.models) || !Array.isArray(editor.pages) || !Array.isArray(editor.sections) ||
        !editor.operations || typeof editor.operations.canCreatePages !== 'boolean' || typeof editor.operations.canEditNavigation !== 'boolean' || typeof editor.operations.canPublish !== 'boolean') {
        throw new Error('Template editor contract is invalid');
    }
    if (!renderer || renderer.contractVersion !== 1 || renderer.templateId !== identity.id || renderer.templateVersion !== identity.version ||
        !renderer.preview || renderer.preview.protocolVersion !== 1 || !Array.isArray(renderer.preview.capabilities) ||
        !renderer.assets || !['published', 'embedded'].includes(renderer.assets.mode) || typeof renderer.assets.basePath !== 'string' || !renderer.assets.basePath.startsWith('/')) {
        throw new Error('Template renderer contract is invalid');
    }
    if (!compatibility || compatibility.cmsSchema !== 1 || compatibility.releaseSchema !== 1 || !Array.isArray(compatibility.migrations)) {
        throw new Error('Template compatibility contract is invalid');
    }
    const modelKeys = new Set(editor.models.map((item) => item.modelKey));
    const pageKeys = new Set(editor.pages.map((item) => item.pageKey));
    const sectionKeys = new Set(editor.sections.map((item) => item.type));
    if (modelKeys.size !== editor.models.length || pageKeys.size !== editor.pages.length || sectionKeys.size !== editor.sections.length) throw new Error('Template editor contract has duplicate keys');
    for (const model of editor.models) {
        if (!modelKeys.has(model.modelKey) || !Array.isArray(model.fields)) throw new Error('Template editor model is invalid');
        const fields = new Set(model.fields.map((field) => field.key));
        if (fields.size !== model.fields.length || model.fields.some((field) => typeof field.key !== 'string' || typeof field.label !== 'string' || typeof field.control !== 'string')) throw new Error('Template editor field is invalid');
    }
    for (const page of editor.pages) {
        if (!pageKeys.has(page.pageKey) || !modelKeys.has(page.modelKey) || !page.pathRule || !['fixed', 'pattern'].includes(page.pathRule.type) || typeof page.pathRule.value !== 'string' || !Array.isArray(page.sections) || page.sections.some((section) => !sectionKeys.has(section))) throw new Error('Template editor page is invalid');
    }
    for (const section of editor.sections) {
        if (!Array.isArray(section.allowedPages) || section.allowedPages.some((page) => !pageKeys.has(page)) || !section.props || typeof section.props !== 'object') throw new Error('Template editor section is invalid');
        for (const prop of Object.values(section.props)) {
            if (!prop || !['text', 'number', 'boolean', 'date', 'enum', 'media', 'reference', 'rich-text', 'array', 'widget'].includes(prop.control) ||
                prop.label !== undefined && (typeof prop.label !== 'string' || !prop.label.trim()) ||
                prop.visibleWhen !== undefined && (!prop.visibleWhen || typeof prop.visibleWhen.field !== 'string' || !(prop.visibleWhen.field in section.props) || !Object.prototype.hasOwnProperty.call(prop.visibleWhen, 'equals')) ||
                prop.minimum !== undefined && (prop.control !== 'number' || typeof prop.minimum !== 'number' || !Number.isFinite(prop.minimum)) ||
                prop.integer !== undefined && (prop.control !== 'number' || typeof prop.integer !== 'boolean') ||
                prop.options !== undefined && (!Array.isArray(prop.options) || prop.options.some(option => typeof option !== 'string'))) throw new Error('Template section property is invalid');
        }
    }
    for (const migration of compatibility.migrations) {
        if (!migration || migration.to !== `${identity.id}@${identity.version}` || typeof migration.from !== 'string' || !Array.isArray(migration.steps)) throw new Error('Template migration is invalid');
    }
    return { editor, renderer, compatibility };
}
