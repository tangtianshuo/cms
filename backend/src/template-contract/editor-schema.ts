import { PropType } from '../prop/models/main';
import type { PresetManifest } from '../presets/catalog';
import type { TemplateEditorContract } from './model';

const controlByType: Record<string, TemplateEditorContract['models'][number]['fields'][number]['control']> = {
    [PropType.STRING]: 'text', [PropType.NUMBER]: 'number', [PropType.BOOLEAN]: 'boolean', [PropType.DATE]: 'date',
    [PropType.ENUMERATION]: 'enum', [PropType.MEDIA]: 'media', [PropType.GROUP_POINTER]: 'reference',
    [PropType.ENTRY_POINTER]: 'reference', [PropType.WIDGET]: 'widget', [PropType.RICH_TEXT]: 'rich-text',
};

export interface EditorSchemaField {
    key: string;
    label: string;
    control: string;
    required: boolean;
    array: boolean;
    description?: string;
    default?: unknown;
    options?: string[];
}

export function editorSchemaForModel(preset: PresetManifest, modelKey: string): EditorSchemaField[] {
    const model = preset.models.find((item) => item.key === modelKey);
    if (!model) throw new Error(`Template model not found: ${modelKey}`);
    const declared = preset.editor?.models.find((item) => item.modelKey === modelKey);
    return model.fields.map((field) => {
        const editor = declared?.fields.find((item) => item.key === field.key);
        return { key: field.key, label: editor?.label || field.label, control: editor?.control || controlByType[field.type] || 'text', required: editor?.required ?? field.required, array: field.array,
            ...(editor?.description ? { description: editor.description } : {}), ...(editor?.default !== undefined ? { default: editor.default } : {}), ...(editor?.options ? { options: editor.options } : {}) };
    });
}

export function editorSchemaForSite(preset: PresetManifest): { models: Record<string, EditorSchemaField[]>; contract: TemplateEditorContract | null } {
    return { models: Object.fromEntries(preset.models.map((model) => [model.key, editorSchemaForModel(preset, model.key)])), contract: preset.editor || null };
}

/** Keep the template's declarations intact for section controls, including conditional values. */
export function editorSchemaForSection(preset: PresetManifest, type: string) {
    const fallback: Record<string, string> = { title: '标题', image: '图片', body: '正文', price: '价格', eyebrow: '引导文字', columns: '每行数量' };
    return Object.entries(preset.editor?.sections.find(section => section.type === type)?.props || {}).map(([key, field]) => ({ ...field, key, label: field.label || field.description || fallback[key] || '内容', required: field.required ?? false }));
}
