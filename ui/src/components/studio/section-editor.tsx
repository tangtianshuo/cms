import { defineComponent, type PropType } from 'vue';

export type SectionType = 'hero-carousel' | 'info-grid' | 'faq' | 'product-gallery' | 'product-information' | 'product-description';
export interface SectionConfig { type: SectionType; enabled: boolean; data: Record<string, unknown> }
type Item = Record<string, any>;
interface ImageOption { _id: string; name: string; mimetype: string }
const labels: Record<SectionType, string> = {
    'hero-carousel': '首页轮播', 'info-grid': '信息卡片', faq: '常见问题',
    'product-gallery': '商品图片', 'product-information': '商品信息', 'product-description': '商品详情',
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initial = (type: SectionType): Record<string, unknown> => type === 'hero-carousel' ? { slides: [] } : type === 'product-gallery' ? { images: [] } : ['faq', 'info-grid'].includes(type) ? { items: [] } : {};

export const SectionEditor = defineComponent({
    name: 'SectionEditor',
    props: {
        modelValue: { type: Array as PropType<SectionConfig[]>, required: true },
        allowed: { type: Array as PropType<SectionType[]>, required: true },
        required: { type: Array as PropType<SectionType[]>, default: () => [] },
        media: { type: Array as PropType<ImageOption[]>, default: () => [] },
        onUpload: Function as PropType<() => void>,
        disabled: Boolean,
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const update = (value: SectionConfig[]) => emit('update:modelValue', copy(value));
        const edit = (index: number, change: (section: SectionConfig) => void) => {
            const next = copy(props.modelValue); change(next[index]); update(next);
        };
        const items = (section: SectionConfig, key: string): Item[] => Array.isArray(section.data[key]) ? section.data[key] as Item[] : [];
        const listEdit = (index: number, key: string, change: (value: Item[]) => void) => edit(index, section => {
            const list = items(section, key); change(list);
            section.data[key] = key === 'slides' ? list.map((item, order) => ({ ...item, order })) : list;
        });
        const add = (type: SectionType) => {
            if (!props.modelValue.some(item => item.type === type)) update([...props.modelValue, { type, enabled: true, data: initial(type) }]);
        };
        const move = (index: number, delta: number) => {
            const target = index + delta;
            if (target < 0 || target >= props.modelValue.length) return;
            const next = copy(props.modelValue); [next[index], next[target]] = [next[target], next[index]]; update(next);
        };
        const field = (label: string, value: unknown, change: (value: string) => void, multiline = false, required = false) => <label>{label}{multiline
            ? <textarea aria-label={label} rows={3} disabled={props.disabled} required={required} value={String(value ?? '')} onInput={event => change((event.target as HTMLTextAreaElement).value)} />
            : <input aria-label={label} disabled={props.disabled} required={required} value={String(value ?? '')} onInput={event => change((event.target as HTMLInputElement).value)} />}</label>;
        const image = (label: string, id: string, change: (value: string) => void) => <label>{label} *<select aria-label={label} required disabled={props.disabled} value={id || ''} onChange={event => change((event.target as HTMLSelectElement).value)}>
            <option value="">请选择图片</option>{id && !props.media.some(item => item._id === id) && <option value={id}>原有图片（素材未加载）</option>}{props.media.filter(item => item.mimetype.startsWith('image/')).map(item => <option value={item._id}>{item.name}</option>)}
        </select></label>;
        const rowActions = (index: number, key: string, row: number, label: string, count: number) => <div class="studio-section-actions">
            {[-1, 1].map(delta => <button type="button" aria-label={`${delta < 0 ? '上移' : '下移'} ${label}`} disabled={props.disabled || row + delta < 0 || row + delta >= count} onClick={() => listEdit(index, key, list => { [list[row], list[row + delta]] = [list[row + delta], list[row]]; })}>{delta < 0 ? '上移' : '下移'}</button>)}
            <button type="button" aria-label={`移除 ${label}`} disabled={props.disabled} onClick={() => listEdit(index, key, list => list.splice(row, 1))}>移除</button>
        </div>;
        const renderData = (section: SectionConfig, index: number) => {
            if (section.type === 'hero-carousel') return <div class="studio-section-content">
                <p class="studio-help">至少添加一张图片。跳转地址可填网站页面路径，例如 /collections。</p>
                {items(section, 'slides').length === 0 && image('轮播图片', '', value => listEdit(index, 'slides', list => list.push({ image: { _id: value }, order: 0 })))}
                {items(section, 'slides').map((slide, row, list) => <div class="studio-section-item" key={row}><h4>轮播 {row + 1}</h4>
                    {image(`轮播 ${row + 1} 图片`, slide.image?._id, value => listEdit(index, 'slides', list => { list[row].image = { _id: value }; }))}
                    {field(`轮播 ${row + 1} 标题`, slide.title, value => listEdit(index, 'slides', list => { list[row].title = value; }))}
                    {field(`轮播 ${row + 1} 副标题`, slide.subtitle, value => listEdit(index, 'slides', list => { list[row].subtitle = value; }), true)}
                    {field(`轮播 ${row + 1} 按钮文字`, slide.cta?.label, value => listEdit(index, 'slides', list => { if (!value && !list[row].cta?.href) delete list[row].cta; else list[row].cta = { href: '', ...list[row].cta, label: value }; }))}
                    {field(`轮播 ${row + 1} 跳转地址`, slide.cta?.href, value => listEdit(index, 'slides', list => { if (!value && !list[row].cta?.label) delete list[row].cta; else list[row].cta = { ...list[row].cta, href: value }; }), false, Boolean(slide.cta?.label))}
                    {rowActions(index, 'slides', row, `轮播 ${row + 1}`, list.length)}
                </div>)}
                <button type="button" disabled={props.disabled} onClick={() => listEdit(index, 'slides', list => list.push({ image: { _id: '' }, title: '', subtitle: '', order: list.length }))}>添加轮播图片</button>
                {props.onUpload && <button type="button" disabled={props.disabled} onClick={() => props.onUpload?.()}>上传新图片</button>}
            </div>;
            if (section.type === 'faq' || section.type === 'info-grid') {
                const faq = section.type === 'faq';
                return <div class="studio-section-content">{items(section, 'items').map((item, row, list) => <div class="studio-section-item" key={row}>
                    {field(faq ? `问题 ${row + 1}` : `卡片 ${row + 1} 标题`, faq ? item.question : item.title, value => listEdit(index, 'items', list => { list[row][faq ? 'question' : 'title'] = value; }), false, true)}
                    {field(faq ? `回答 ${row + 1}` : `卡片 ${row + 1} 内容`, faq ? item.answer : item.text || item.description, value => listEdit(index, 'items', list => { list[row][faq ? 'answer' : 'text'] = value; }), true, true)}
                    {rowActions(index, 'items', row, `${faq ? '问答' : '卡片'} ${row + 1}`, list.length)}
                </div>)}<button type="button" disabled={props.disabled} onClick={() => listEdit(index, 'items', list => list.push(faq ? { question: '', answer: '' } : { title: '', text: '' }))}>{faq ? '添加问答' : '添加信息卡片内容'}</button></div>;
            }
            if (section.type === 'product-gallery') return <div class="studio-section-content">
                <p class="studio-help">至少添加一张商品图片。</p>{items(section, 'images').length === 0 && image('商品图片', '', value => listEdit(index, 'images', list => list.push({ _id: value })))}
                {items(section, 'images').map((item, row, list) => <div class="studio-section-item" key={row}>{image(`商品图片 ${row + 1}`, item._id, value => listEdit(index, 'images', list => { list[row] = { _id: value }; }))}{rowActions(index, 'images', row, `商品图片 ${row + 1}`, list.length)}</div>)}
                <button type="button" disabled={props.disabled} onClick={() => listEdit(index, 'images', list => list.push({ _id: '' }))}>添加商品图片</button>{props.onUpload && <button type="button" disabled={props.disabled} onClick={() => props.onUpload?.()}>上传新图片</button>}
            </div>;
            if (section.type === 'product-description') return field('详情正文', section.data.body, value => edit(index, section => { section.data.body = value; }), true);
            return <div class="studio-section-content"><p class="studio-help">商品名称和价格使用商品内容中的资料。</p>{items(section, 'specifications').map((item, row, list) => <div class="studio-section-item" key={row}>
                {field(`规格 ${row + 1} 名称`, item.label, value => listEdit(index, 'specifications', list => { list[row].label = value; }))}{field(`规格 ${row + 1} 值`, item.value, value => listEdit(index, 'specifications', list => { list[row].value = value; }))}{rowActions(index, 'specifications', row, `规格 ${row + 1}`, list.length)}
            </div>)}<button type="button" disabled={props.disabled} onClick={() => listEdit(index, 'specifications', list => list.push({ label: '', value: '' }))}>添加商品规格</button></div>;
        };
        return () => <section class="studio-section-editor" aria-label="页面区块">
            <div class="studio-card-heading"><div><h3>页面区块</h3><p class="studio-help">添加、排序或隐藏首页和详情页内容。隐藏的区块不会显示在网站上。</p></div></div>
            <div class="studio-section-actions">{props.allowed.filter(type => !props.modelValue.some(item => item.type === type)).map(type => <button type="button" disabled={props.disabled} onClick={() => add(type)}>添加{labels[type]}</button>)}</div>
            <ul class="studio-section-list">{props.modelValue.map((section, index) => <li key={section.type}>
                <div class="studio-section-heading"><strong>{labels[section.type]}</strong><label class="studio-check"><input type="checkbox" checked={section.enabled} disabled={props.disabled} onChange={event => edit(index, section => { section.enabled = (event.target as HTMLInputElement).checked; })} />显示</label>
                <button type="button" aria-label={`上移 ${labels[section.type]}`} disabled={props.disabled || index === 0} onClick={() => move(index, -1)}>上移</button>
                <button type="button" aria-label={`下移 ${labels[section.type]}`} disabled={props.disabled || index === props.modelValue.length - 1} onClick={() => move(index, 1)}>下移</button>
                <button type="button" aria-label={`移除 ${labels[section.type]}`} disabled={props.disabled || props.required.includes(section.type)} onClick={() => update(props.modelValue.filter((_, itemIndex) => itemIndex !== index))}>移除</button></div>
                {section.enabled && renderData(section, index)}
            </li>)}</ul>
        </section>;
    },
});
