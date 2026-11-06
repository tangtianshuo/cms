import { defineComponent, ref, type PropType } from 'vue';
import { StructuredField } from './structured-field';
import { structuredValue } from './structured-value';
import type { PropValue } from '@bcms/selfhosted-backend/prop/models/main';
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
        onUpload: Function as PropType<() => void>,
        onChange: { type: Function as PropType<(key: string, value: StudioValue) => void>, required: true },
    },
    setup(props) {
        const sdk = window.bcms.sdk;
        return () => <div class="studio-fields">{props.model.fields.map(field => {
            const template = sdk.store.template.findById(props.model.templateId);
            const prop = template?.props.find(item => item.name === field.key);
            const value = props.values[field.key];
            if (!prop) return <p class="studio-help">{field.label}：此内容暂时只读，原有内容会完整保留。</p>;
            const data = value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'prop-data'
                ? value.data : Array.isArray(value) ? value : value === undefined ? [] : [value];
            return <StructuredField key={prop.id} prop={prop} value={{ id: prop.id, data: data as PropValue['data'] }} entryId="" languageIndex={0} disabled={props.disabled} onChange={nextData => props.onChange(field.key, structuredValue(nextData))} />;
        })}</div>;
    },
});
