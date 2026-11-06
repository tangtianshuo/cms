import type { EditorControl } from '@bcms/selfhosted-backend/template-contract/model';

export interface SectionPropertyField {
    key: string;
    label: string;
    control: EditorControl;
    required: boolean;
    description?: string;
    options?: string[];
    minimum?: number;
    integer?: boolean;
    default?: unknown;
    visibleWhen?: { field: string; equals: unknown };
}
const labels: Record<string, string> = { title: '标题', headline: '标题', image: '图片', body: '正文', price: '价格', eyebrow: '引导文字', columns: '每行数量', count: '数量', href: '按钮链接', buttonHref: '按钮链接', showButton: '显示按钮' };
export function sectionPropertyFields(props: Record<string, Omit<Partial<SectionPropertyField>, 'key'>>): SectionPropertyField[] {
    return Object.entries(props).map(([key, schema]) => ({ ...schema, key, label: schema.label || schema.description || labels[key] || '内容', control: schema.control as EditorControl, required: schema.required ?? false }));
}
export function sectionFieldVisible(field: SectionPropertyField, values: Record<string, unknown>): boolean {
    return !field.visibleWhen || JSON.stringify(values[field.visibleWhen.field]) === JSON.stringify(field.visibleWhen.equals);
}
export function sectionFieldSupported(field: SectionPropertyField): boolean {
    return ['text', 'number', 'boolean', 'date', 'enum', 'media', 'reference', 'rich-text'].includes(field.control);
}
export function sectionFieldError(field: SectionPropertyField, value: unknown): string | null {
    const empty = value === undefined || value === null || typeof value === 'string' && !value.trim() || (['array', 'widget'].includes(field.control) && typeof value === 'object' && (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0)) || (field.control === 'rich-text' && typeof value === 'object' && value !== null && 'nodes' in value && Array.isArray(value.nodes) && value.nodes.length === 0);
    if (field.control === 'rich-text' && !empty && !(value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes))) return '正文格式无效，原有内容会完整保留。';
    if (field.control === 'rich-text' && field.required && value && typeof value === 'object' && !(value as { nodes: unknown[] }).nodes?.length) return `请填写${field.label}。`;
    if (empty) return field.required ? `请填写${field.label}。` : null;
    if (field.control === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return '请输入有效数字。';
    if (field.control === 'number' && typeof value === 'number' && field.minimum !== undefined && value < field.minimum) return `请输入不小于${field.minimum}的数字。`;
    if (field.control === 'number' && field.integer && !Number.isInteger(value)) return '请输入整数。';
    if (field.control === 'boolean' && typeof value !== 'boolean') return '请选择开关状态。';
    if (field.control === 'text' && /href$/i.test(field.key) && (typeof value !== 'string' || !/^(https?:\/\/|\/(?!\/))/.test(value) || value.includes('\\'))) return '请输入有效的网站路径或网址。';
    if (field.control === 'text' && typeof value !== 'string') return '请输入文字。';
    if (field.control === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return '请选择有效日期。';
    if (field.control === 'enum' && !field.options?.includes(String(value))) return '请选择列表中的选项。';
    if (field.control === 'media' && !(typeof value === 'string' && /^(https?:\/\/|\/(?!\/))/.test(value)) && !(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { _id?: unknown })._id === 'string' && Boolean((value as { _id: string })._id.trim()))) return '请选择可访问的图片。';
    if (field.control === 'reference' && !(typeof value === 'string' || value && typeof value === 'object' && typeof (value as { eid?: unknown }).eid === 'string')) return '请选择可访问的内容。';
    return null;
}
export function updateSectionField(values: Record<string, unknown>, field: SectionPropertyField, input: unknown): { values: Record<string, unknown>; error: string | null } {
    if (!sectionFieldSupported(field)) return { values, error: '此内容暂时只读，原有内容会完整保留。' };
    const value = ['number', 'date', 'enum', 'reference'].includes(field.control) && input === '' && !field.required ? undefined : field.control === 'number' && typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
    const error = sectionFieldError(field, value);
    return { values: error ? values : { ...values, [field.key]: value }, error };
}
