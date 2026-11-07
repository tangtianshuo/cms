export interface MigrationDocument {
    models: Record<
        string,
        Array<{ id: string; fields: Record<string, unknown> }>
    >;
    pages: Array<{
        id: string;
        path: string;
        sections: Array<{
            id: string;
            type: string;
            props: Record<string, unknown>;
        }>;
    }>;
}

export type MigrationStep =
    | { op: 'rename-field'; model: string; from: string; to: string }
    | { op: 'set-default'; model: string; field: string; value: unknown }
    | { op: 'rename-section'; from: string; to: string };

export interface MigrationIssue {
    code: string;
    path: string;
}

export interface MigrationPreview {
    document: MigrationDocument;
    changes: Array<{
        kind: 'field' | 'section';
        id: string;
        from: string;
        to: string;
    }>;
    issues: MigrationIssue[];
}

export interface MigrationTargetField {
    key: string;
    type: string;
    required: boolean;
    array: boolean;
    referenceModel?: string;
}

export interface MigrationTarget {
    models: Record<
        string,
        { fields: MigrationTargetField[]; singleEntry?: boolean }
    >;
    pages: Array<{
        key: string;
        path: string;
        sections?: string[];
    }>;
    sections: Array<{
        type: string;
        allowedPages?: string[];
    }>;
    availableMediaIds?: string[];
    templateIds?: Record<string, string>;
}

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const supportedOperations = new Set([
    'rename-field',
    'set-default',
    'rename-section',
]);
const supportedFieldTypes = new Set([
    'STRING',
    'NUMBER',
    'BOOLEAN',
    'DATE',
    'ENUMERATION',
    'MEDIA',
    'ENTRY_POINTER',
    'RICH_TEXT',
    'GROUP_POINTER',
    'WIDGET',
]);

function has(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function issue(issues: MigrationIssue[], code: string, path: string): void {
    if (!issues.some((item) => item.code === code && item.path === path)) {
        issues.push({ code, path });
    }
}

function inspectUnsafeKeys(
    value: unknown,
    path: string,
    issues: MigrationIssue[],
): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            inspectUnsafeKeys(item, `${path}[${index}]`, issues),
        );
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (unsafeKeys.has(key)) {
            issue(issues, 'unsafe_key', childPath);
            continue;
        }
        inspectUnsafeKeys(child, childPath, issues);
    }
}

function valuesOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [value];
}

function nonemptyRequiredValue(value: unknown): boolean {
    const values = valuesOf(value);
    return (
        values.length > 0 &&
        values.every(
            (item) =>
                item !== null &&
                item !== undefined &&
                !(typeof item === 'string' && !item.trim()),
        )
    );
}

function objectWithStringId(value: unknown): boolean {
    return (
        !!value &&
        typeof value === 'object' &&
        typeof (value as { _id?: unknown })._id === 'string' &&
        !!(value as { _id: string })._id
    );
}

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dateValue(value: unknown): boolean {
    return (
        object(value) &&
        typeof value.timestamp === 'number' &&
        Number.isFinite(value.timestamp) &&
        typeof value.timezoneOffset === 'number' &&
        Number.isFinite(value.timezoneOffset)
    );
}

function enumValue(value: unknown): boolean {
    return (
        typeof value === 'string' ||
        (object(value) &&
            Array.isArray(value.items) &&
            value.items.every((item) => typeof item === 'string') &&
            (value.selected === undefined ||
                (typeof value.selected === 'string' &&
                    value.items.includes(value.selected))))
    );
}

function groupPointerValue(value: unknown): boolean {
    return (
        object(value) &&
        typeof value._id === 'string' &&
        !!value._id &&
        Array.isArray(value.items) &&
        value.items.every((item) => object(item) && Array.isArray(item.props))
    );
}

function widgetValue(value: unknown): boolean {
    return (
        object(value) &&
        typeof value._id === 'string' &&
        !!value._id &&
        Array.isArray(value.props) &&
        value.props.every(
            (item) =>
                object(item) && typeof item.id === 'string' && 'data' in item,
        )
    );
}

function pointer(value: unknown): { tid: string; eid: string } | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { tid?: unknown; eid?: unknown };
    return typeof candidate.tid === 'string' &&
        candidate.tid &&
        typeof candidate.eid === 'string' &&
        candidate.eid
        ? { tid: candidate.tid, eid: candidate.eid }
        : null;
}

function pathPattern(value: string): RegExp {
    const escaped = value
        .split('/')
        .map((part) => {
            if (/^:[a-z][a-z0-9]*$/.test(part)) return '[a-z0-9-]+';
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    return new RegExp(`^${escaped}$`);
}

function matchingTargetPage(
    path: string,
    target: MigrationTarget,
): MigrationTarget['pages'][number] | undefined {
    return target.pages.find((page) => pathPattern(page.path).test(path));
}

function validateValueType(
    model: string,
    entryId: string,
    field: MigrationTargetField,
    values: unknown[],
    document: MigrationDocument,
    target: MigrationTarget,
    issues: MigrationIssue[],
): void {
    const path = `${model}/${entryId}/${field.key}`;
    for (const value of values) {
        const type = field.type.toUpperCase();
        if (type === 'STRING' && typeof value !== 'string') {
            issue(issues, 'field_value', path);
        } else if (
            type === 'NUMBER' &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        ) {
            issue(issues, 'field_value', path);
        } else if (type === 'BOOLEAN' && typeof value !== 'boolean') {
            issue(issues, 'field_value', path);
        } else if (type === 'DATE' && !dateValue(value)) {
            issue(issues, 'field_value', path);
        } else if (type === 'ENUMERATION' && !enumValue(value)) {
            issue(issues, 'field_value', path);
        } else if (type === 'MEDIA') {
            if (!objectWithStringId(value)) {
                issue(issues, 'field_value', path);
            } else if (
                target.availableMediaIds &&
                !target.availableMediaIds.includes(
                    (value as { _id: string })._id,
                )
            ) {
                issue(issues, 'media_missing', path);
            }
        } else if (type === 'ENTRY_POINTER') {
            const reference = pointer(value);
            const related =
                field.referenceModel &&
                reference &&
                document.models[field.referenceModel]?.some(
                    (entry) => entry.id === reference.eid,
                );
            const expectedTemplate =
                field.referenceModel &&
                target.templateIds?.[field.referenceModel];
            if (
                !reference ||
                !field.referenceModel ||
                !related ||
                (expectedTemplate && reference.tid !== expectedTemplate)
            ) {
                issue(issues, 'entry_reference', path);
            }
        } else if (
            type === 'RICH_TEXT' &&
            (!value || typeof value !== 'object')
        ) {
            issue(issues, 'field_value', path);
        } else if (type === 'GROUP_POINTER' && !groupPointerValue(value)) {
            issue(issues, 'field_value', path);
        } else if (type === 'WIDGET' && !widgetValue(value)) {
            issue(issues, 'field_value', path);
        } else if (!supportedFieldTypes.has(type)) {
            issue(issues, 'unknown_field_type', path);
        }
    }
}

function validateDocument(
    document: MigrationDocument,
    target: MigrationTarget,
    issues: MigrationIssue[],
): void {
    for (const modelKey of Object.keys(target.models)) {
        if (!has(document.models, modelKey)) {
            issue(issues, 'missing_model', modelKey);
        }
    }
    for (const [modelKey, entries] of Object.entries(document.models)) {
        const definition = target.models[modelKey];
        if (!definition) {
            issue(issues, 'unknown_model', modelKey);
            continue;
        }
        if (definition.singleEntry && entries.length !== 1) {
            issue(issues, 'single_entry', modelKey);
        }
        const declared = new Map(
            definition.fields.map((field) => [field.key, field]),
        );
        for (const entry of entries) {
            for (const key of Object.keys(entry.fields)) {
                if (!declared.has(key)) {
                    issue(
                        issues,
                        'unknown_field',
                        `${modelKey}/${entry.id}/${key}`,
                    );
                }
            }
            for (const field of definition.fields) {
                if (!has(entry.fields, field.key)) {
                    if (field.required) {
                        issue(
                            issues,
                            'required_field',
                            `${modelKey}/${entry.id}/${field.key}`,
                        );
                    }
                    continue;
                }
                const value = entry.fields[field.key];
                const arrayShaped =
                    field.array || field.type.toUpperCase() === 'RICH_TEXT';
                if (arrayShaped && !Array.isArray(value)) {
                    issue(
                        issues,
                        'field_shape',
                        `${modelKey}/${entry.id}/${field.key}`,
                    );
                    continue;
                }
                if (!arrayShaped && Array.isArray(value)) {
                    issue(
                        issues,
                        'field_shape',
                        `${modelKey}/${entry.id}/${field.key}`,
                    );
                    continue;
                }
                const values = valuesOf(value);
                if (field.required && !nonemptyRequiredValue(value)) {
                    issue(
                        issues,
                        'required_field',
                        `${modelKey}/${entry.id}/${field.key}`,
                    );
                }
                validateValueType(
                    modelKey,
                    entry.id,
                    field,
                    values,
                    document,
                    target,
                    issues,
                );
            }
        }
    }

    const seenPaths = new Set<string>();
    for (const page of document.pages) {
        if (seenPaths.has(page.path)) {
            issue(issues, 'duplicate_page_path', page.path);
        }
        seenPaths.add(page.path);
        const definition = matchingTargetPage(page.path, target);
        if (!definition) {
            issue(issues, 'invalid_page_path', page.path);
        }
        for (const section of page.sections) {
            const sectionDefinition = target.sections.find(
                (candidate) => candidate.type === section.type,
            );
            const allowedForPage =
                !definition?.sections ||
                definition.sections.includes(section.type);
            if (
                !sectionDefinition ||
                !allowedForPage ||
                (sectionDefinition.allowedPages &&
                    (!definition ||
                        !sectionDefinition.allowedPages.includes(
                            definition.key,
                        )))
            ) {
                issue(
                    issues,
                    'unknown_section',
                    `${page.id}/${section.id}/${section.type}`,
                );
            }
        }
    }
    for (const page of target.pages) {
        if (
            !document.pages.some((candidate) =>
                pathPattern(page.path).test(candidate.path),
            )
        ) {
            issue(issues, 'missing_page', page.key);
        }
    }
}

export function previewMigration(
    document: MigrationDocument,
    steps: readonly MigrationStep[],
    target?: MigrationTarget,
): MigrationPreview {
    const issues: MigrationIssue[] = [];
    inspectUnsafeKeys(document, '', issues);
    const candidate = structuredClone(document);
    const changes: MigrationPreview['changes'] = [];

    for (let index = 0; index < steps.length; index++) {
        const raw = steps[index] as unknown;
        if (
            !raw ||
            typeof raw !== 'object' ||
            typeof (raw as { op?: unknown }).op !== 'string' ||
            !supportedOperations.has((raw as { op: string }).op)
        ) {
            issue(issues, 'unsupported_operation', `steps[${index}]`);
            continue;
        }
        const step = raw as MigrationStep;
        if (step.op === 'rename-section') {
            if (!step.from || !step.to) {
                issue(issues, 'invalid_step', `steps[${index}]`);
                continue;
            }
            for (const page of candidate.pages) {
                for (const section of page.sections) {
                    if (section.type !== step.from) continue;
                    section.type = step.to;
                    changes.push({
                        kind: 'section',
                        id: `${page.id}/${section.id}`,
                        from: step.from,
                        to: step.to,
                    });
                }
            }
            continue;
        }

        if (
            !step.model ||
            unsafeKeys.has(step.model) ||
            !candidate.models[step.model]
        ) {
            issue(
                issues,
                unsafeKeys.has(step.model) ? 'unsafe_key' : 'unknown_model',
                step.model || `steps[${index}]`,
            );
            continue;
        }
        if (
            (step.op === 'rename-field' &&
                (!step.from ||
                    !step.to ||
                    unsafeKeys.has(step.from) ||
                    unsafeKeys.has(step.to))) ||
            (step.op === 'set-default' &&
                (!step.field || unsafeKeys.has(step.field)))
        ) {
            issue(issues, 'invalid_step', `steps[${index}]`);
            continue;
        }
        for (const entry of candidate.models[step.model]) {
            if (step.op === 'rename-field') {
                if (
                    has(entry.fields, step.from) &&
                    has(entry.fields, step.to)
                ) {
                    issue(
                        issues,
                        'target_exists',
                        `${step.model}/${entry.id}/${step.to}`,
                    );
                } else if (has(entry.fields, step.from)) {
                    entry.fields[step.to] = entry.fields[step.from];
                    delete entry.fields[step.from];
                    changes.push({
                        kind: 'field',
                        id: `${step.model}/${entry.id}`,
                        from: step.from,
                        to: step.to,
                    });
                }
            } else if (
                step.op === 'set-default' &&
                !has(entry.fields, step.field)
            ) {
                entry.fields[step.field] = structuredClone(step.value);
                changes.push({
                    kind: 'field',
                    id: `${step.model}/${entry.id}`,
                    from: '<missing>',
                    to: step.field,
                });
            }
        }
    }

    inspectUnsafeKeys(candidate, '', issues);
    if (target) validateDocument(candidate, target, issues);
    return { document: candidate, changes, issues };
}
