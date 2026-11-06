import { defineComponent, ref, type PropType } from 'vue';
import type { StudioModel } from '../../sdk/handlers/studio';
import type { StudioValue } from '@bcms/selfhosted-backend/studio/business';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';

export const StudioMediaPicker = defineComponent({
    props: {
        fieldId: { type: String, required: true }, fieldKey: { type: String, required: true },
        value: { type: Array as PropType<Array<{ _id: string; alt_text?: string; caption?: string }>>, required: true },
        media: { type: Array as PropType<Media[]>, required: true }, multiple: Boolean, disabled: Boolean,
        invalid: Boolean, describedBy: String,
        onUpload: Function as PropType<() => void>,
        onChange: { type: Function as PropType<(value: Array<{ _id: string; alt_text?: string; caption?: string }>) => void>, required: true },
    },
    setup(props) {
        const picker = ref(''); const mediaFilter = ref(''); const sdk = window.bcms.sdk;
        return () => { const value = props.value; return <div>
                        <div class="studio-media-selection">{(Array.isArray(value) ? value : []).filter((item): item is { _id: string; alt_text?: string; caption?: string } => '_id' in item).map(item => {
                            const media = props.media.find(media => media._id === item._id);
                            return <div class="studio-selected-file"><span>{media?.name || item._id}</span><button type="button" disabled={props.disabled} aria-label={`移除 ${media?.name || item._id}`} onClick={() => props.onChange((value as Array<{ _id: string }>).filter(file => file._id !== item._id))}>移除</button></div>;
                        })}</div>
                        <button id={props.fieldId} aria-invalid={props.invalid} aria-describedby={props.describedBy} type="button" disabled={props.disabled} aria-expanded={picker.value === props.fieldKey} onClick={() => { picker.value = picker.value === props.fieldKey ? '' : props.fieldKey; }}>选择已有素材</button>
                        {props.onUpload && <button type="button" disabled={props.disabled} class="studio-upload-button" onClick={() => { picker.value = props.fieldKey; props.onUpload?.(); }}>上传新图片</button>}
                        {picker.value === props.fieldKey && <div class="studio-picker"><label for={`${props.fieldId}-filter`}>筛选图片</label><input id={`${props.fieldId}-filter`} value={mediaFilter.value} onInput={event => { mediaFilter.value = (event.target as HTMLInputElement).value; }} />
                            {props.media.length === 0 && <p class="studio-help">没有可访问的图片。{props.onUpload ? '点击「上传新图片」添加，上传完成后即可在这里选择。' : '请联系管理员上传图片。'}</p>}
                            <div class="studio-media-grid">{props.media.filter(media => media.name.toLowerCase().includes(mediaFilter.value.toLowerCase())).map(media => {
                                const selected = Array.isArray(value) && value.some(item => '_id' in item && item._id === media._id);
                                return <button type="button" disabled={props.disabled} class={{ selected }} aria-pressed={selected} onClick={() => {
                                    const items = Array.isArray(value) ? value.filter(item => '_id' in item) as Array<{ _id: string }> : [];
                                    props.onChange(selected ? items.filter(item => item._id !== media._id) : props.multiple ? [...items, { _id: media._id }] : [{ _id: media._id }]);
                                    if (!props.multiple) picker.value = '';
                                }}><img loading="lazy" src={`${sdk.config.apiOrigin}${sdk.media.toUri({ media })}`} alt={media.altText || media.name} /><span>{media.name}</span></button>;
                            })}</div></div>}
                    </div>; };
    },
});

export const StudioFields = defineComponent({
    props: {
        model: { type: Object as PropType<StudioModel>, required: true },
        models: { type: Array as PropType<StudioModel[]>, required: true },
        values: { type: Object as PropType<Record<string, StudioValue>>, required: true },
        media: { type: Array as PropType<Media[]>, required: true },
        isNew: Boolean, disabled: Boolean,
        onUpload: { type: Function as PropType<() => void>, required: false },
        onChange: { type: Function as PropType<(key: string, value: StudioValue) => void>, required: true },
    },
    setup(props) {
        return () => <div class="studio-fields">{props.model.fields.map(field => {
            const value = props.values[field.key];
            const editorField = props.model.editorFields?.find(item => item.key === field.key);
            const label = editorField?.label || field.label;
            const control = editorField?.control || '';
            const fieldId = `studio-field-${field.key}`;
            if (!field.editable && !(props.isNew && field.type === 'RICH_TEXT')) return <div id={fieldId} tabindex={-1} class="studio-field" key={field.key}><span class="studio-label">{label}</span><p class="studio-help">{field.type === 'RICH_TEXT' ? '富文本内容完整保留。请使用完整编辑器修改排版和正文。' : '此字段使用完整编辑器维护，保存时保留原值。'}</p></div>;
            return <div class="studio-field" key={field.key}><label for={fieldId}>{label}{(editorField?.required ?? field.required) ? ' *' : ''}</label>{editorField?.description && <p class="studio-help">{editorField.description}</p>}
                {control === 'enum' ? <select id={fieldId} disabled={props.disabled} required={field.required} value={String(value ?? '')} onChange={event => props.onChange(field.key, (event.target as HTMLSelectElement).value)}><option value="">未选择</option>{(editorField?.options || []).map(option => <option value={option}>{option}</option>)}</select>
                    : control === 'date' ? <input id={fieldId} type="date" disabled={props.disabled} required={field.required} value={String(value ?? '')} onInput={event => props.onChange(field.key, (event.target as HTMLInputElement).value)} />
                    : control === 'rich-text' || field.type === 'STRING' || field.type === 'RICH_TEXT' ? (control === 'rich-text' || field.type === 'RICH_TEXT' || ['description', 'summary', 'intro', 'seoDescription', 'announcement'].includes(field.key)
                    ? <textarea id={fieldId} disabled={props.disabled} required={field.required} rows={4} value={String(value ?? '')} onInput={event => props.onChange(field.key, (event.target as HTMLTextAreaElement).value)} />
                    : <input id={fieldId} disabled={props.disabled} required={field.required} value={String(value ?? '')} onInput={event => props.onChange(field.key, (event.target as HTMLInputElement).value)} />)
                    : field.type === 'NUMBER' ? <input id={fieldId} type="number" step="any" min={field.key === 'price' ? 0 : undefined} required={field.required} disabled={props.disabled} value={typeof value === 'number' ? value : ''} onInput={event => { const raw = (event.target as HTMLInputElement).value; props.onChange(field.key, raw === '' ? '' : Number(raw)); }} />
                    : field.type === 'BOOLEAN' ? <input id={fieldId} type="checkbox" disabled={props.disabled} checked={Boolean(value)} onChange={event => props.onChange(field.key, (event.target as HTMLInputElement).checked)} />
                    : field.type === 'ENTRY_POINTER' ? <select id={fieldId} disabled={props.disabled} multiple={field.array} value={field.array ? (Array.isArray(value) ? value.flatMap(item => 'eid' in item ? [item.eid] : []) : []) : (Array.isArray(value) && value[0] && 'eid' in value[0] ? value[0].eid : '')}
                        onChange={event => { const selected = Array.from((event.target as HTMLSelectElement).selectedOptions).filter(option => option.value); props.onChange(field.key, selected.map(option => ({ tid: option.dataset.template!, eid: option.value }))); }}>
                        {!field.array && <option value="">未选择</option>}
                        {props.models.filter(model => field.referenceTemplateIds.includes(model.templateId)).flatMap(model => model.entries.map(entry => <option value={entry.id} data-template={model.templateId}>{String((entry.fields.title as string[] | undefined)?.[0] || entry.id)}</option>))}
                    </select>
                    : field.type === 'MEDIA' ? <StudioMediaPicker fieldId={fieldId} fieldKey={field.key} value={(Array.isArray(value) ? value.filter(item => '_id' in item) : []) as Array<{ _id: string }>} media={props.media} multiple={field.array} disabled={props.disabled} onUpload={props.onUpload} onChange={items => props.onChange(field.key, items)} /> : null}
                {field.type === 'RICH_TEXT' && props.isNew && <p class="studio-help">新正文按纯文本段落创建；保存后可在完整编辑器中排版。</p>}
                {field.key === 'slug' && <p class="studio-help">使用小写英文、数字和短横线，例如 shipping-policy。</p>}
            </div>;
        })}</div>;
    },
});
