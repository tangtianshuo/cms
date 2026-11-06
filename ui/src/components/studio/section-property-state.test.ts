import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionPropertyFields, sectionFieldVisible, updateSectionField } from './section-property-state';
const field = (control: any, required = false) => ({ key: 'value', label: '内容', control, required });
test('keeps false and zero without mutating unrelated and unknown complex content', () => {
    const base = { value: true, unknown: { nodes: [{ text: '原内容' }] } };
    assert.deepEqual(updateSectionField(base, field('boolean'), false).values, { ...base, value: false });
    assert.equal(updateSectionField(base, field('number', true), '0').values.value, 0);
    assert.equal(base.value, true);
});
test('required empty, invalid numbers, dates, enums and media references cannot overwrite valid data', () => {
    const base = { value: 3 };
    for (const [schema, input] of [[field('text', true), '  '], [field('number'), 'oops'], [field('number'), Infinity], [field('date'), '2026-02-30'], [{ ...field('enum'), options: ['one'] }, 'two'], [field('media'), { _id: '' }]] as Array<[any, unknown]>) {
        const result = updateSectionField(base, schema, input);
        assert.ok(result.error); assert.deepEqual(result.values, base);
    }
});
test('hidden values remain intact and unknown and complex controls are explicitly disabled', () => {
    const hidden = { ...field('text', true), visibleWhen: { field: 'enabled', equals: true } };
    assert.equal(sectionFieldVisible(hidden, { enabled: false }), false);
    for (const control of ['mystery', 'rich-text', 'array', 'widget']) {
        const base = { value: { content: [{ text: '保留' }] }, enabled: false };
        assert.ok(updateSectionField(base, field(control), 'replacement').error);
        assert.deepEqual(updateSectionField(base, field(control), 'replacement').values, base);
    }
});
test('legacy declarations get useful labels and defaults without leaking undefined', () => {
    assert.deepEqual(sectionPropertyFields({ title: { control: 'text' }, custom: { control: 'text', description: '说明' }, count: { control: 'number', default: 0 } }), [
        { key: 'title', label: '标题', control: 'text', required: false }, { key: 'custom', label: '说明', control: 'text', required: false, description: '说明' }, { key: 'count', label: '数量', control: 'number', required: false, default: 0 },
    ]);
});


test('clearing optional scalar and reference inputs removes the value without disturbing other fields', () => {
    for (const control of ['number', 'date', 'enum', 'reference']) {
        const result = updateSectionField({ value: 5, other: false }, field(control), '');
        assert.equal(result.error, null);
        assert.deepEqual(result.values, { value: undefined, other: false });
    }
});

test('number constraints are declaration-specific and preserve unconstrained zero and fractions', () => {
    const constrained = { ...field('number'), minimum: 1, integer: true };
    for (const value of ['0', '-1', '1.5']) assert.ok(updateSectionField({ value: 3 }, constrained, value).error);
    assert.equal(updateSectionField({ value: 3 }, constrained, '4').values.value, 4);
    for (const value of [0, -1, 1.5]) assert.equal(updateSectionField({ value: 3 }, field('number'), value).error, null);
});
