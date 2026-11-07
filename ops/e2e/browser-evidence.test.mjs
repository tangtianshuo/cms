import test from 'node:test';
import assert from 'node:assert/strict';
import { finishBrowserEvidence } from './browser-evidence.mjs';
test('a forbidden authenticated request still finalizes and retains sanitized diagnostics before failing', async () => {
    const events = [];
    const failure = Error('Forbidden publication request');
    await assert.rejects(
        finishBrowserEvidence({
            assertSafe() {
                events.push('guard');
                throw failure;
            },
            timeline: {
                finish() {
                    events.push('finish');
                    return { events: [] };
                },
            },
            failed: false,
            retain: async () => events.push('retain'),
        }),
        (error) => error === failure,
    );
    assert.deepEqual(events, ['guard', 'finish', 'retain']);
});
test('passing interaction always detaches timeline listeners and does not retain failure diagnostics', async () => {
    let finished = false,
        retained = false;
    await finishBrowserEvidence({
        assertSafe() {},
        timeline: {
            finish() {
                finished = true;
            },
        },
        failed: false,
        retain: async () => {
            retained = true;
        },
    });
    assert.equal(finished, true);
    assert.equal(retained, false);
});
