import { defineComponent, ref, type PropType } from 'vue';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import type { StudioModel } from '../../sdk/handlers/studio';
import { StudioMediaPicker } from './fields';
import { sectionFieldError, sectionFieldSupported, sectionFieldVisible, updateSectionField, type SectionPropertyField } from './section-property-state';

export const SectionPropertyFields = defineComponent({
    props: {
        nodeId: { type: String, required: true },
        fields: { type: Array as PropType<SectionPropertyField[]>, required: true },
        values: { type: Object as PropType<Record<string, unknown>>, required: true },
        media: { type: Array as PropType<Media[]>, default: () => [] },
        models: { type: Array as PropType<StudioModel[]>, default: () => [] },
        disabled: Boolean,
        onUpload: Function as PropType<() => void>,
        onChange: { type: Function as PropType<(key: string, value: unknown) => void>, required: true },
        onValidation: Function as PropType<(key: string, error: string | null) => void>,
    },
    setup(props) {
        const inputs = ref<Record<string, unknown>>({});
        const errors = ref<Record<string, string>>({});
        const change = (field: SectionPropertyField, input: unknown) => {
            if (props.disabled) return;
            inputs.value[field.key] = input;
            const result = updateSectionField(props.values, field, input);
            errors.value[field.key] = result.error || '';
            props.onValidation?.(field.key, result.error);
            if (!result.error) props.onChange(field.key, result.values[field.key]);
        };
        return () => <div class="studio-section-fields">{props.fields.filter(field => sectionFieldVisible(field, { ...Object.fromEntries(props.fields.filter(item => item.default !== undefined).map(item => [item.key, item.default])), ...props.values })).map(field => {
            const fieldId = `section-${props.nodeId}-${field.key}`;
            const value = field.key in inputs.value ? inputs.value[field.key] : props.values[field.key] ?? field.default;
            const error = errors.value[field.key] || sectionFieldError(field, value);
            const common = { id: fieldId, disabled: props.disabled, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${fieldId}-error` : field.description ? `${fieldId}-help` : undefined };
            return <div class="studio-field" key={field.key}><label for={fieldId}>{field.label}{field.required ? ' *' : ''}</label>
                {field.description && <p id={`${fieldId}-help`} class="studio-help">{field.description}</p>}
                {!sectionFieldSupported(field) ? <div id={fieldId} tabindex={-1} aria-disabled="true" class="studio-help">此内容暂时只读，原有内容会完整保留。</div>
                    : field.control === 'boolean' ? <input {...common} type="checkbox" checked={value === true} onChange={event => change(field, (event.target as HTMLInputElement).checked)} />
                    : field.control === 'enum' ? <select {...common} value={String(value ?? '')} onChange={event => change(field, (event.target as HTMLSelectElement).value)}><option value="">未选择</option>{field.options?.map(option => <option value={option}>{option}</option>)}</select>
                    : field.control === 'media' ? <StudioMediaPicker fieldId={fieldId} fieldKey={field.key} invalid={Boolean(error)} describedBy={error ? `${fieldId}-error` : undefined} value={value && typeof value === 'object' && '_id' in value ? [value as { _id: string }] : []} media={props.media} disabled={props.disabled} onUpload={props.onUpload} onChange={items => change(field, items[0] || '')} />
                    : field.control === 'reference' ? <select {...common} value={typeof value === 'string' ? value : (value as { eid?: string })?.eid || ''} onChange={event => change(field, (event.target as HTMLSelectElement).value)}><option value="">未选择</option>{props.models.flatMap(model => model.entries.map(entry => <option value={entry.id}>{String((entry.fields.title as string[] | undefined)?.[0] || entry.id)}</option>))}</select>
                    : <input {...common} type={field.control === 'number' ? 'number' : field.control === 'date' ? 'date' : 'text'} step={field.control === 'number' ? 'any' : undefined} value={String(value ?? '')} onInput={event => change(field, (event.target as HTMLInputElement).value)} />}
                {error && sectionFieldSupported(field) && <p id={`${fieldId}-error`} role="alert" class="studio-field-error">{error}</p>}
            </div>;
        })}{props.fields.length === 0 && <p class="studio-help">这个区块没有可编辑的内容。</p>}</div>;
    },
});
