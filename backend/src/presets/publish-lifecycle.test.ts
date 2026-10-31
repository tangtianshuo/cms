import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePublishStatus } from './publish-lifecycle';

test('maps gateway states to stable user-facing publish lifecycle states', () => {
    assert.equal(normalizePublishStatus('pending'), 'publishing');
    assert.equal(normalizePublishStatus('ready'), 'ready');
    assert.equal(normalizePublishStatus('failed'), 'failed');
    assert.equal(normalizePublishStatus('ready', 'rollback'), 'rolled-back');
    assert.equal(normalizePublishStatus('unexpected'), 'draft');
});
