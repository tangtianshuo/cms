import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assessHealth,
    createMonitorState,
    dueNotifications,
    markNotificationDelivered,
    markNotificationFailed,
    reconcileAlerts,
} from './policy.mjs';

const healthy = Object.freeze({
    siteId: 'site-a',
    publicStatus: 200,
    latencyMs: 80,
    expectedRelease: true,
    missingAssets: 0,
    certificateDaysLeft: 30,
    backupAgeHours: 1,
    consecutiveFailures: 0,
    publishFailureCount15m: 0,
    controlAvailable: true,
});

test('alerts on a wrong active site despite HTTP 200', () => {
    const input = {
        ...healthy,
        expectedRelease: false,
        consecutiveFailures: 3,
    };
    assert.ok(
        assessHealth(input).some(
            (alert) => alert.key === 'site-a:release-mismatch',
        ),
    );
});

test('alerts only after three consecutive public 5xx responses', () => {
    assert.deepEqual(
        assessHealth({ ...healthy, publicStatus: 503, consecutiveFailures: 2 }),
        [],
    );
    assert.equal(
        assessHealth({
            ...healthy,
            publicStatus: 503,
            consecutiveFailures: 3,
            expectedRelease: false,
        })[0].key,
        'site-a:public-unavailable',
    );
    assert.equal(
        assessHealth({
            ...healthy,
            publicStatus: 503,
            consecutiveFailures: 3,
            expectedRelease: false,
        }).length,
        1,
    );
});

test('treats repeated connection failures as unavailable after three samples', () => {
    assert.deepEqual(
        assessHealth({
            ...healthy,
            publicStatus: 0,
            consecutiveFailures: 2,
            expectedRelease: false,
        }),
        [],
    );
    assert.equal(
        assessHealth({
            ...healthy,
            publicStatus: 0,
            consecutiveFailures: 3,
            expectedRelease: false,
        })[0].key,
        'site-a:public-unavailable',
    );
});

test('reports resource, certificate, backup and publish failures separately', () => {
    const keys = assessHealth({
        ...healthy,
        missingAssets: 1,
        certificateDaysLeft: 13,
        backupAgeHours: 26.1,
        publishFailureCount15m: 3,
    }).map((alert) => alert.key);
    assert.deepEqual(keys, [
        'site-a:missing-assets',
        'site-a:certificate-expiring',
        'site-a:backup-stale',
        'site-a:publish-failures',
    ]);
});

test('keeps control-plane availability distinct from public availability', () => {
    const alerts = assessHealth({ ...healthy, controlAvailable: false });
    assert.deepEqual(
        alerts.map((alert) => [alert.key, alert.severity]),
        [['site-a:control-unavailable', 'critical']],
    );
    assert.equal(healthy.publicStatus, 200);
});

test('warns on slow responses only after three samples above three seconds', () => {
    assert.deepEqual(
        assessHealth({
            ...healthy,
            latencyMs: 3001,
            consecutiveFailures: 2,
            consecutiveSlowSamples: 2,
        }),
        [],
    );
    assert.equal(
        assessHealth({
            ...healthy,
            latencyMs: 3001,
            consecutiveFailures: 0,
            consecutiveSlowSamples: 3,
        })[0].key,
        'site-a:slow-response',
    );
});

test('alerts when backup completion evidence cannot be accepted', () => {
    assert.equal(
        assessHealth({ ...healthy, backupEvidenceAccepted: false })[0].key,
        'site-a:backup-unverified',
    );
    assert.deepEqual(
        assessHealth({
            ...healthy,
            backupAgeHours: 27,
            backupEvidenceAccepted: false,
            expectedLockedTemplate: false,
        }).map((alert) => alert.key),
        ['site-a:backup-unverified'],
    );
});

test('alerts when the expected site template is absent from the locked target', () => {
    assert.deepEqual(
        assessHealth({ ...healthy, expectedLockedTemplate: false }).map(
            (alert) => alert.key,
        ),
        ['site-a:locked-target-mismatch'],
    );
});

test('rejects incomplete health input rather than silently passing it', () => {
    assert.throws(
        () => assessHealth({ ...healthy, publicStatus: '200' }),
        /publicStatus/,
    );
    assert.throws(() => assessHealth({ ...healthy, siteId: '' }), /siteId/);
});

test('persists alert dedupe across restart and emits one recovery event', () => {
    const started = Date.parse('2026-11-07T00:00:00Z');
    let state = createMonitorState();
    let transition = reconcileAlerts(
        state,
        'site-a',
        [
            {
                key: 'site-a:release-mismatch',
                severity: 'critical',
                message: 'wrong',
            },
        ],
        started,
    );
    state = transition.state;
    assert.equal(transition.notifications.length, 1);

    state = markNotificationDelivered(
        state,
        transition.notifications[0].id,
        started + 100,
    );
    const restarted = JSON.parse(JSON.stringify(state));
    transition = reconcileAlerts(
        restarted,
        'site-a',
        [
            {
                key: 'site-a:release-mismatch',
                severity: 'critical',
                message: 'wrong',
            },
        ],
        started + 60_000,
    );
    assert.equal(transition.notifications.length, 0);

    transition = reconcileAlerts(
        transition.state,
        'site-a',
        [],
        started + 120_000,
    );
    assert.equal(transition.notifications.length, 1);
    assert.equal(transition.notifications[0].kind, 'recovery');
    assert.equal(
        reconcileAlerts(transition.state, 'site-a', [], started + 180_000)
            .notifications.length,
        0,
    );
});

test('allows one reminder after fifteen minutes and keeps delivery retry separate', () => {
    const started = Date.parse('2026-11-07T00:00:00Z');
    let state = createMonitorState();
    let transition = reconcileAlerts(
        state,
        'site-a',
        [
            {
                key: 'site-a:public-unavailable',
                severity: 'critical',
                message: 'down',
            },
        ],
        started,
    );
    state = transition.state;
    const first = transition.notifications[0];
    state = markNotificationDelivered(state, first.id, started + 1_000);

    transition = reconcileAlerts(
        state,
        'site-a',
        [
            {
                key: 'site-a:public-unavailable',
                severity: 'critical',
                message: 'down',
            },
        ],
        started + 15 * 60_000 + 1_000,
    );
    assert.equal(transition.notifications.length, 1);
    assert.equal(transition.notifications[0].kind, 'alert');
    state = transition.state;

    const failed = markNotificationFailed(
        state,
        transition.notifications[0].id,
        'receiver unavailable',
        started + 15 * 60_000 + 2_000,
        5_000,
    );
    assert.equal(failed.state.sites['site-a'].deliveryHistory.length, 1);
    assert.equal(failed.state.sites['site-a'].pending.length, 1);
    assert.equal(
        dueNotifications(failed.state, started + 15 * 60_000 + 3_000).length,
        0,
    );
    assert.equal(
        dueNotifications(failed.state, started + 15 * 60_000 + 8_000).length,
        1,
    );
});
