import assert from 'node:assert/strict';
import test from 'node:test';
import { reactive } from 'vue';
import { createPreviewGate, sendPreview } from '../src/components/storefront/preview-state.ts';

test('only the latest preview request may update the iframe', () => {
    const gate = createPreviewGate();
    const first = gate.next();
    const second = gate.next();
    assert.equal(gate.isCurrent(first), false);
    assert.equal(gate.isCurrent(second), true);
});

test('preview message uses the exact configured target origin', () => {
    const messages = [];
    const frame = { contentWindow: { postMessage: (...args) => messages.push(args) } };
    const page = { product: { name: 'Unsaved title' } };
    sendPreview(frame, 'http://localhost:3000', page);
    assert.deepEqual(messages, [[{ type: 'storefront:preview', payload: page }, 'http://localhost:3000']]);
});

test('preview message can cross the iframe structured-clone boundary', () => {
    let delivered;
    const frame = {
        contentWindow: {
            postMessage(message, targetOrigin) {
                delivered = { message: structuredClone(message), targetOrigin };
            },
        },
    };
    const page = reactive({ product: { name: 'Unsaved title', price: 39 } });

    sendPreview(frame, 'http://localhost:3000', page);

    assert.deepEqual(delivered, {
        message: { type: 'storefront:preview', payload: { product: { name: 'Unsaved title', price: 39 } } },
        targetOrigin: 'http://localhost:3000',
    });
});
