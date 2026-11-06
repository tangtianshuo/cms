import assert from 'node:assert/strict';
import test from 'node:test';
import { reactive, type VNode } from 'vue';
import { SectionPropertyFields } from './section-property-fields';

function findInput(node: unknown): VNode | undefined {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node) && (node as VNode).type === 'input') return node as VNode;
    const children = Array.isArray(node) ? node : (node as VNode).children;
    for (const child of Array.isArray(children) ? children : []) {
        const input = findInput(child);
        if (input) return input;
    }
}
function inputNode(node: VNode): VNode {
    const input = findInput(node);
    assert.ok(input, 'Rendered input missing');
    return input;
}

test('number input validates the typed value after actual component rerender and clears prior errors', () => {
    const values = reactive<Record<string, unknown>>({ columns: 3 });
    const validations: Array<string | null> = [];
    const props = { nodeId: 'grid', fields: [{ key: 'columns', label: '每行数量', control: 'number', required: false }], values, media: [], models: [], disabled: false,
        onChange: (key: string, value: unknown) => { values[key] = value; }, onValidation: (_key: string, error: string | null) => validations.push(error) };
    const render = SectionPropertyFields.setup?.(props as never, {} as never) as () => VNode;
    let input = inputNode(render());
    input.props?.onInput({ target: { value: '4' } });
    input = inputNode(render());
    assert.equal(values.columns, 4);
    assert.equal(validations.at(-1), null);
    assert.equal(input.props?.['aria-invalid'], false);
    input.props?.onInput({ target: { value: 'invalid' } });
    assert.equal(inputNode(render()).props?.['aria-invalid'], true);
    assert.equal(values.columns, 4);
    inputNode(render()).props?.onInput({ target: { value: '2' } });
    assert.equal(inputNode(render()).props?.['aria-invalid'], false);
    assert.equal(values.columns, 2);
    inputNode(render()).props?.onInput({ target: { value: '0' } });
    assert.equal(inputNode(render()).props?.['aria-invalid'], false);
    assert.equal(values.columns, 0);
    inputNode(render()).props?.onInput({ target: { value: '' } });
    assert.equal(inputNode(render()).props?.['aria-invalid'], false);
    assert.equal(values.columns, undefined);
});

test('declared numeric constraints render native bounds and retain invalid local input until repaired', () => {
    const values = reactive<Record<string, unknown>>({ columns: 3 });
    const props = { nodeId: 'grid', fields: [{ key: 'columns', label: '每行数量', control: 'number', required: false, minimum: 1, integer: true }], values, media: [], models: [], disabled: false,
        onChange: (key: string, value: unknown) => { values[key] = value; } };
    const render = SectionPropertyFields.setup?.(props as never, {} as never) as () => VNode;
    assert.equal(inputNode(render()).props?.min, 1);
    assert.equal(inputNode(render()).props?.step, 1);
    for (const raw of ['0', '-1', '1.5']) {
        inputNode(render()).props?.onInput({ target: { value: raw } });
        assert.equal(inputNode(render()).props?.['aria-invalid'], true);
        assert.equal(inputNode(render()).props?.value, raw);
        assert.equal(values.columns, 3);
    }
    inputNode(render()).props?.onInput({ target: { value: '4' } });
    assert.equal(inputNode(render()).props?.['aria-invalid'], false);
    assert.equal(values.columns, 4);
});
