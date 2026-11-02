import type { PresetManifest } from '../presets/catalog';
import { editorSchemaForModel, type EditorSchemaField } from '../template-contract/editor-schema';

export type ContentFormField = EditorSchemaField;
export type ContentFormErrors = Record<string, string>;

export function buildContentForm(preset: PresetManifest, modelKey: string): ContentFormField[] {
    return editorSchemaForModel(preset, modelKey).map((field) => ({ ...field }));
}

function empty(value: unknown, array: boolean): boolean {
    if (array) return !Array.isArray(value) || value.length === 0;
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function validateContentValues(schema: ContentFormField[], values: Record<string, unknown>): ContentFormErrors {
    const errors: ContentFormErrors = {};
    for (const field of schema) {
        if (field.required && empty(values[field.key], field.array)) errors[field.key] = `${field.label} is required`;
    }
    return errors;
}
