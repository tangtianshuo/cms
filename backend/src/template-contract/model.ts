export type EditorControl =
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'media'
    | 'reference'
    | 'rich-text'
    | 'array'
    | 'widget';

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
    control: EditorControl;
    required?: boolean;
    label?: string;
    description?: string;
    default?: unknown;
    options?: string[];
    visibleWhen?: { field: string; equals: unknown };
    minimum?: number;
    integer?: boolean;
}

export interface TemplateEditorContract {
    schemaVersion: 1;
    models: Array<{ modelKey: string; fields: TemplateEditorField[] }>;
    pages: Array<{
        pageKey: string;
        modelKey: string;
        pathRule: { type: 'fixed' | 'pattern'; value: string };
        allowNavigation: boolean;
        sections: string[];
    }>;
    sections: Array<{
        type: string;
        label: string;
        description?: string;
        allowedPages: string[];
        singleton: boolean;
        required: boolean;
        props: Record<string, TemplateSectionProperty>;
    }>;
    operations: {
        canCreatePages: boolean;
        canEditNavigation: boolean;
        canPublish: boolean;
    };
}

export interface TemplateRendererContract {
    contractVersion: 1;
    templateId: string;
    templateVersion: string;
    preview: { protocolVersion: 1; capabilities: string[] };
    assets: { mode: 'published' | 'embedded'; basePath: string };
}

export interface TemplateStructureChange {
    kind: 'model' | 'field' | 'page' | 'section' | 'renderer';
    id: string;
    from: string;
    to: string;
}

export interface TemplateStructureIssue {
    code: string;
    path: string;
}

export interface TemplateStructureComparison {
    changes: TemplateStructureChange[];
    issues: TemplateStructureIssue[];
}

function stable(value: unknown): string {
    return JSON.stringify(value);
}

/**
 * Compare only contract structure. Visual/theme/version changes are handled by
 * the upgrade layer and must not silently turn a content-model change into a
 * compatible adoption.
 */
export function compareTemplateStructures(
    currentEditor: TemplateEditorContract,
    nextEditor: TemplateEditorContract,
    currentRenderer?: TemplateRendererContract,
    nextRenderer?: TemplateRendererContract,
): TemplateStructureComparison {
    const changes: TemplateStructureChange[] = [];
    const issues: TemplateStructureIssue[] = [];
    const currentModels = new Map(
        currentEditor.models.map((model) => [model.modelKey, model]),
    );
    const nextModels = new Map(
        nextEditor.models.map((model) => [model.modelKey, model]),
    );
    for (const [key, current] of currentModels) {
        const next = nextModels.get(key);
        if (!next) {
            changes.push({
                kind: 'model',
                id: key,
                from: 'present',
                to: 'missing',
            });
            issues.push({ code: 'model_removed', path: key });
            continue;
        }
        const currentFields = new Map(
            current.fields.map((field) => [field.key, field]),
        );
        const nextFields = new Map(
            next.fields.map((field) => [field.key, field]),
        );
        for (const [fieldKey, field] of currentFields) {
            const target = nextFields.get(fieldKey);
            if (!target) {
                changes.push({
                    kind: 'field',
                    id: `${key}/${fieldKey}`,
                    from: 'present',
                    to: 'missing',
                });
                issues.push({
                    code: 'field_removed',
                    path: `${key}/${fieldKey}`,
                });
                continue;
            }
            const before = stable({
                control: field.control,
                group: field.group,
                required: field.required,
                default: field.default,
                options: field.options,
                visibleWhen: field.visibleWhen,
            });
            const after = stable({
                control: target.control,
                group: target.group,
                required: target.required,
                default: target.default,
                options: target.options,
                visibleWhen: target.visibleWhen,
            });
            if (before !== after) {
                changes.push({
                    kind: 'field',
                    id: `${key}/${fieldKey}`,
                    from: field.control,
                    to: target.control,
                });
                if (
                    field.control !== target.control ||
                    field.group !== target.group ||
                    field.required !== target.required ||
                    stable(field.default) !== stable(target.default) ||
                    stable(field.options) !== stable(target.options) ||
                    field.visibleWhen !== target.visibleWhen
                ) {
                    issues.push({
                        code: 'field_definition_changed',
                        path: `${key}/${fieldKey}`,
                    });
                }
            }
        }
        for (const [fieldKey, field] of nextFields) {
            if (currentFields.has(fieldKey)) continue;
            changes.push({
                kind: 'field',
                id: `${key}/${fieldKey}`,
                from: 'missing',
                to: field.control,
            });
            if (field.required) {
                issues.push({
                    code: 'required_field_added',
                    path: `${key}/${fieldKey}`,
                });
            }
        }
    }
    for (const key of nextModels.keys()) {
        if (currentModels.has(key)) continue;
        changes.push({
            kind: 'model',
            id: key,
            from: 'missing',
            to: 'present',
        });
    }

    const currentPages = new Map(
        currentEditor.pages.map((page) => [page.pageKey, page]),
    );
    const nextPages = new Map(
        nextEditor.pages.map((page) => [page.pageKey, page]),
    );
    for (const [key, page] of currentPages) {
        const target = nextPages.get(key);
        if (!target) {
            changes.push({
                kind: 'page',
                id: key,
                from: 'present',
                to: 'missing',
            });
            issues.push({ code: 'page_removed', path: key });
            continue;
        }
        if (
            page.modelKey !== target.modelKey ||
            stable(page.pathRule) !== stable(target.pathRule) ||
            stable(page.sections) !== stable(target.sections) ||
            page.allowNavigation !== target.allowNavigation
        ) {
            changes.push({
                kind: 'page',
                id: key,
                from: `${page.modelKey}:${page.pathRule.value}`,
                to: `${target.modelKey}:${target.pathRule.value}`,
            });
            if (
                page.modelKey !== target.modelKey ||
                stable(page.pathRule) !== stable(target.pathRule)
            ) {
                issues.push({
                    code: 'page_definition_changed',
                    path: key,
                });
            }
        }
    }
    for (const [key, page] of nextPages) {
        if (!currentPages.has(key)) {
            changes.push({
                kind: 'page',
                id: key,
                from: 'missing',
                to: page.pathRule.value,
            });
        }
    }

    const currentSections = new Map(
        currentEditor.sections.map((section) => [section.type, section]),
    );
    const nextSections = new Map(
        nextEditor.sections.map((section) => [section.type, section]),
    );
    for (const [type, section] of currentSections) {
        const target = nextSections.get(type);
        if (!target) {
            changes.push({
                kind: 'section',
                id: type,
                from: 'present',
                to: 'missing',
            });
            issues.push({ code: 'section_removed', path: type });
            continue;
        }
        const before = stable({
            allowedPages: section.allowedPages,
            singleton: section.singleton,
            required: section.required,
            props: section.props,
        });
        const after = stable({
            allowedPages: target.allowedPages,
            singleton: target.singleton,
            required: target.required,
            props: target.props,
        });
        if (before !== after) {
            changes.push({
                kind: 'section',
                id: type,
                from: section.label,
                to: target.label,
            });
            if (
                stable(section.props) !== stable(target.props) ||
                stable(section.allowedPages) !== stable(target.allowedPages)
            ) {
                issues.push({
                    code: 'section_definition_changed',
                    path: type,
                });
            }
        }
    }
    for (const [type, section] of nextSections) {
        if (!currentSections.has(type)) {
            changes.push({
                kind: 'section',
                id: type,
                from: 'missing',
                to: section.label,
            });
        }
    }

    if (currentRenderer && nextRenderer) {
        const currentCapabilities = new Set(
            currentRenderer.preview.capabilities,
        );
        const nextCapabilities = new Set(nextRenderer.preview.capabilities);
        for (const capability of currentCapabilities) {
            if (!nextCapabilities.has(capability)) {
                changes.push({
                    kind: 'renderer',
                    id: capability,
                    from: 'available',
                    to: 'missing',
                });
                issues.push({
                    code: 'renderer_capability_removed',
                    path: capability,
                });
            }
        }
        for (const capability of nextCapabilities) {
            if (!currentCapabilities.has(capability)) {
                changes.push({
                    kind: 'renderer',
                    id: capability,
                    from: 'missing',
                    to: 'available',
                });
            }
        }
        if (
            currentRenderer.assets.mode !== nextRenderer.assets.mode ||
            currentRenderer.assets.basePath !== nextRenderer.assets.basePath
        ) {
            changes.push({
                kind: 'renderer',
                id: 'assets',
                from: currentRenderer.assets.mode,
                to: nextRenderer.assets.mode,
            });
            issues.push({ code: 'renderer_assets_changed', path: 'assets' });
        }
    }
    return { changes, issues };
}

export interface TemplateCompatibility {
    cmsSchema: 1;
    releaseSchema: 1;
    migrations: Array<{
        from: string;
        to: string;
        steps: Array<Record<string, unknown>>;
    }>;
}

export function validateTemplateContract(
    value: unknown,
    identity: { id: string; version: string },
): {
    editor: TemplateEditorContract;
    renderer: TemplateRendererContract;
    compatibility: TemplateCompatibility;
} {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Template contract is invalid');
    const input = value as Record<string, unknown>;
    const editor = input.editor as TemplateEditorContract | undefined;
    const renderer = input.renderer as TemplateRendererContract | undefined;
    const compatibility = input.compatibility as
        | TemplateCompatibility
        | undefined;
    if (
        !editor ||
        editor.schemaVersion !== 1 ||
        !Array.isArray(editor.models) ||
        !Array.isArray(editor.pages) ||
        !Array.isArray(editor.sections) ||
        !editor.operations ||
        typeof editor.operations.canCreatePages !== 'boolean' ||
        typeof editor.operations.canEditNavigation !== 'boolean' ||
        typeof editor.operations.canPublish !== 'boolean'
    ) {
        throw new Error('Template editor contract is invalid');
    }
    if (
        !renderer ||
        renderer.contractVersion !== 1 ||
        renderer.templateId !== identity.id ||
        renderer.templateVersion !== identity.version ||
        !renderer.preview ||
        renderer.preview.protocolVersion !== 1 ||
        !Array.isArray(renderer.preview.capabilities) ||
        !renderer.assets ||
        !['published', 'embedded'].includes(renderer.assets.mode) ||
        typeof renderer.assets.basePath !== 'string' ||
        !renderer.assets.basePath.startsWith('/')
    ) {
        throw new Error('Template renderer contract is invalid');
    }
    if (
        !compatibility ||
        compatibility.cmsSchema !== 1 ||
        compatibility.releaseSchema !== 1 ||
        !Array.isArray(compatibility.migrations)
    ) {
        throw new Error('Template compatibility contract is invalid');
    }
    const modelKeys = new Set(editor.models.map((item) => item.modelKey));
    const pageKeys = new Set(editor.pages.map((item) => item.pageKey));
    const sectionKeys = new Set(editor.sections.map((item) => item.type));
    if (
        modelKeys.size !== editor.models.length ||
        pageKeys.size !== editor.pages.length ||
        sectionKeys.size !== editor.sections.length
    )
        throw new Error('Template editor contract has duplicate keys');
    for (const model of editor.models) {
        if (!modelKeys.has(model.modelKey) || !Array.isArray(model.fields))
            throw new Error('Template editor model is invalid');
        const fields = new Set(model.fields.map((field) => field.key));
        if (
            fields.size !== model.fields.length ||
            model.fields.some(
                (field) =>
                    typeof field.key !== 'string' ||
                    typeof field.label !== 'string' ||
                    typeof field.control !== 'string',
            )
        )
            throw new Error('Template editor field is invalid');
    }
    for (const page of editor.pages) {
        if (
            !pageKeys.has(page.pageKey) ||
            !modelKeys.has(page.modelKey) ||
            !page.pathRule ||
            !['fixed', 'pattern'].includes(page.pathRule.type) ||
            typeof page.pathRule.value !== 'string' ||
            !Array.isArray(page.sections) ||
            page.sections.some((section) => !sectionKeys.has(section))
        )
            throw new Error('Template editor page is invalid');
    }
    for (const section of editor.sections) {
        if (
            !Array.isArray(section.allowedPages) ||
            section.allowedPages.some((page) => !pageKeys.has(page)) ||
            !section.props ||
            typeof section.props !== 'object'
        )
            throw new Error('Template editor section is invalid');
        for (const prop of Object.values(section.props)) {
            if (
                !prop ||
                ![
                    'text',
                    'number',
                    'boolean',
                    'date',
                    'enum',
                    'media',
                    'reference',
                    'rich-text',
                    'array',
                    'widget',
                ].includes(prop.control) ||
                (prop.label !== undefined &&
                    (typeof prop.label !== 'string' || !prop.label.trim())) ||
                (prop.visibleWhen !== undefined &&
                    (!prop.visibleWhen ||
                        typeof prop.visibleWhen.field !== 'string' ||
                        !(prop.visibleWhen.field in section.props) ||
                        !Object.prototype.hasOwnProperty.call(
                            prop.visibleWhen,
                            'equals',
                        ))) ||
                (prop.minimum !== undefined &&
                    (prop.control !== 'number' ||
                        typeof prop.minimum !== 'number' ||
                        !Number.isFinite(prop.minimum))) ||
                (prop.integer !== undefined &&
                    (prop.control !== 'number' ||
                        typeof prop.integer !== 'boolean')) ||
                (prop.options !== undefined &&
                    (!Array.isArray(prop.options) ||
                        prop.options.some(
                            (option) => typeof option !== 'string',
                        )))
            )
                throw new Error('Template section property is invalid');
        }
    }
    for (const migration of compatibility.migrations) {
        if (
            !migration ||
            migration.to !== `${identity.id}@${identity.version}` ||
            typeof migration.from !== 'string' ||
            !Array.isArray(migration.steps)
        )
            throw new Error('Template migration is invalid');
    }
    return { editor, renderer, compatibility };
}
