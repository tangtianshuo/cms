import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsMetric, analyticsViewState } from '../src/views/dashboard/analytics-state.ts';

test('distinguishes unconfigured, failed and successful empty analytics', () => {
    assert.equal(analyticsViewState({ loading: true, error: '', configured: false, hasData: false }), 'loading');
    assert.equal(analyticsViewState({ loading: false, error: '', configured: false, hasData: true }), 'unconfigured');
    assert.equal(analyticsViewState({ loading: false, error: 'down', configured: true, hasData: false }), 'error');
    assert.equal(analyticsViewState({ loading: false, error: '', configured: true, hasData: true }), 'ready');
    assert.equal(analyticsViewState({ loading: false, error: '', configured: true, hasData: false }), 'error');
});

test('only a successful response may render a zero metric', () => {
    assert.equal(analyticsMetric(0, 'ready'), '0');
    assert.equal(analyticsMetric(undefined, 'ready'), '—');
    assert.equal(analyticsMetric(0, 'unconfigured'), '—');
    assert.equal(analyticsMetric(0, 'error'), '—');
});
