const numericFields = [
    'publicStatus',
    'latencyMs',
    'missingAssets',
    'certificateDaysLeft',
    'backupAgeHours',
    'consecutiveFailures',
    'publishFailureCount15m',
];
export const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const deliveryHistoryLimit = 100;
const maximumDeliveryAttempts = 8;
const defaultBackupMaxAgeHours = 26;

function requireHealth(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('health must be an object');
    }
    if (typeof value.siteId !== 'string' || !value.siteId.trim()) {
        throw new TypeError('siteId must be a non-empty string');
    }
    for (const field of numericFields) {
        if (
            typeof value[field] !== 'number' ||
            !Number.isFinite(value[field])
        ) {
            throw new TypeError(`${field} must be a finite number`);
        }
    }
    if (typeof value.expectedRelease !== 'boolean') {
        throw new TypeError('expectedRelease must be a boolean');
    }
    if (
        value.controlAvailable !== undefined &&
        typeof value.controlAvailable !== 'boolean'
    ) {
        throw new TypeError('controlAvailable must be a boolean');
    }
    if (
        value.consecutiveSlowSamples !== undefined &&
        (!Number.isSafeInteger(value.consecutiveSlowSamples) ||
            value.consecutiveSlowSamples < 0)
    ) {
        throw new TypeError(
            'consecutiveSlowSamples must be a non-negative integer',
        );
    }
    if (
        value.backupMaxAgeHours !== undefined &&
        (typeof value.backupMaxAgeHours !== 'number' ||
            !Number.isFinite(value.backupMaxAgeHours) ||
            value.backupMaxAgeHours <= 0)
    ) {
        throw new TypeError('backupMaxAgeHours must be a positive number');
    }
    if (value.publishQueue !== undefined) {
        if (
            !value.publishQueue ||
            typeof value.publishQueue !== 'object' ||
            Array.isArray(value.publishQueue) ||
            !value.publishQueue.limits ||
            typeof value.publishQueue.limits !== 'object' ||
            Array.isArray(value.publishQueue.limits)
        ) {
            throw new TypeError('publishQueue must contain counts and limits');
        }
        for (const field of [
            'sitePending',
            'workspacePending',
            'globalPending',
            'siteActiveLeases',
            'workspaceActiveLeases',
            'globalActiveLeases',
        ]) {
            if (
                !Number.isSafeInteger(value.publishQueue[field]) ||
                value.publishQueue[field] < 0
            ) {
                throw new TypeError(
                    `publishQueue.${field} must be a non-negative integer`,
                );
            }
        }
        for (const field of [
            'sitePending',
            'workspacePending',
            'siteActiveLeases',
            'workspaceActiveLeases',
            'globalActiveLeases',
            'siteStartIntervalMs',
            'retryAfterSeconds',
        ]) {
            if (
                !Number.isSafeInteger(value.publishQueue.limits[field]) ||
                value.publishQueue.limits[field] < 1
            ) {
                throw new TypeError(
                    `publishQueue.limits.${field} must be a positive integer`,
                );
            }
        }
    }
}

function alert(siteId, kind, severity, message) {
    return { key: `${siteId}:${kind}`, severity, message };
}

/**
 * Project one health sample into operator alerts. Thresholds are deliberately
 * centralised here; transport and durable delivery state live elsewhere.
 */
export function assessHealth(value) {
    requireHealth(value);
    const alerts = [];
    const site = value.siteId;

    if (value.controlAvailable === false) {
        alerts.push(
            alert(
                site,
                'control-unavailable',
                'critical',
                'The publication control plane is unavailable',
            ),
        );
    }
    if (value.publicStatus === 200 && !value.expectedRelease) {
        alerts.push(
            alert(
                site,
                'release-mismatch',
                'critical',
                'The public site does not match the expected release',
            ),
        );
    }
    if (
        value.expectedLockedTemplate === false &&
        value.backupEvidenceAccepted !== false
    ) {
        alerts.push(
            alert(
                site,
                'locked-target-mismatch',
                'critical',
                'The expected site template is absent from the locked target',
            ),
        );
    }
    if (
        ((value.publicStatus === 0 || value.publicStatus >= 500) &&
            value.consecutiveFailures >= 3) ||
        (value.publicStatus > 0 &&
            value.publicStatus !== 200 &&
            value.publicStatus < 500)
    ) {
        alerts.push(
            alert(
                site,
                'public-unavailable',
                'critical',
                'The public site is unavailable',
            ),
        );
    }
    if (value.missingAssets > 0) {
        alerts.push(
            alert(
                site,
                'missing-assets',
                'warning',
                `${value.missingAssets} representative asset probe(s) failed`,
            ),
        );
    }
    if (value.certificateDaysLeft < 14) {
        alerts.push(
            alert(
                site,
                'certificate-expiring',
                'warning',
                'The public certificate expires in less than 14 days',
            ),
        );
    }
    const backupMaxAgeHours =
        value.backupMaxAgeHours ?? defaultBackupMaxAgeHours;
    if (
        value.backupAgeHours > backupMaxAgeHours &&
        value.backupEvidenceAccepted !== false
    ) {
        alerts.push(
            alert(
                site,
                'backup-stale',
                'warning',
                `The latest integrity-verified backup is more than ${backupMaxAgeHours} hours old`,
            ),
        );
    }
    if (value.backupEvidenceAccepted === false) {
        alerts.push(
            alert(
                site,
                'backup-unverified',
                'critical',
                'No integrity-verified backup completion evidence is available',
            ),
        );
    }
    if (value.publishFailureCount15m >= 3) {
        alerts.push(
            alert(
                site,
                'publish-failures',
                'warning',
                'At least three publication operations failed in the last 15 minutes',
            ),
        );
    }
    if (value.publishQueue) {
        const queue = value.publishQueue;
        if (queue.sitePending >= queue.limits.sitePending) {
            alerts.push(
                alert(
                    site,
                    'publish-site-backlog',
                    'warning',
                    'The site has reached its pending publication limit',
                ),
            );
        }
        if (queue.workspacePending >= queue.limits.workspacePending) {
            alerts.push(
                alert(
                    site,
                    'publish-workspace-backlog',
                    'warning',
                    'The workspace has reached its pending publication limit',
                ),
            );
        }
        if (
            queue.globalActiveLeases >= queue.limits.globalActiveLeases &&
            queue.globalPending > queue.globalActiveLeases
        ) {
            alerts.push(
                alert(
                    site,
                    'publish-global-capacity',
                    'warning',
                    'The global publication queue is at active capacity',
                ),
            );
        }
    }

    const slowSamples =
        value.consecutiveSlowSamples ?? value.consecutiveFailures;
    if (value.latencyMs > 3000 && slowSamples >= 3) {
        alerts.push(
            alert(
                site,
                'slow-response',
                'warning',
                'The public site exceeded the three-second response threshold three times',
            ),
        );
    }
    return alerts;
}

export function createMonitorState() {
    return {
        schemaVersion: 1,
        updatedAt: null,
        nextNotificationId: 1,
        sites: {},
    };
}

function requireState(state) {
    if (
        !state ||
        state.schemaVersion !== 1 ||
        !state.sites ||
        typeof state.sites !== 'object' ||
        Array.isArray(state.sites) ||
        !Number.isSafeInteger(state.nextNotificationId)
    ) {
        throw new TypeError('Invalid monitor state');
    }
}

function siteState(state, siteId) {
    state.sites[siteId] ??= {
        alerts: {},
        pending: [],
        deliveryHistory: [],
        deliveryFailures: [],
        consecutiveSlowSamples: 0,
    };
    return state.sites[siteId];
}

function enqueueNotification(state, siteId, item, now) {
    const owned = siteState(state, siteId);
    const notification = {
        id: `monitor-${state.nextNotificationId++}`,
        siteId,
        key: item.key,
        kind: item.kind,
        severity: item.severity,
        message: item.message,
        occurredAt: new Date(now).toISOString(),
        attempts: 0,
        nextAttemptAt: new Date(now).toISOString(),
        lastError: null,
    };
    owned.pending.push(notification);
    return notification;
}

/**
 * Reconcile active conditions and create durable notification work. Alert state
 * and receiver delivery are separate so a failed channel cannot suppress a
 * recovery event or make public traffic unhealthy.
 */
export function reconcileAlerts(state, siteId, alerts, now = Date.now()) {
    requireState(state);
    if (typeof siteId !== 'string' || !siteId) {
        throw new TypeError('siteId must be a non-empty string');
    }
    if (!Array.isArray(alerts) || !Number.isFinite(now)) {
        throw new TypeError('alerts and numeric time are required');
    }
    const next = structuredClone(state);
    const owned = siteState(next, siteId);
    const current = new Map();
    for (const item of alerts) {
        if (
            !item ||
            typeof item.key !== 'string' ||
            !item.key ||
            !['critical', 'warning'].includes(item.severity) ||
            typeof item.message !== 'string'
        ) {
            throw new TypeError('Invalid alert');
        }
        current.set(item.key, item);
    }
    const notifications = [];

    for (const [key, previous] of Object.entries(owned.alerts)) {
        if (current.has(key)) continue;
        notifications.push(
            enqueueNotification(
                next,
                siteId,
                {
                    key,
                    kind: 'recovery',
                    severity: previous.severity,
                    message: `Recovered: ${previous.message}`,
                },
                now,
            ),
        );
        delete owned.alerts[key];
    }

    for (const item of current.values()) {
        const previous = owned.alerts[item.key];
        if (!previous) {
            owned.alerts[item.key] = {
                severity: item.severity,
                message: item.message,
                firstSeenAt: new Date(now).toISOString(),
                lastSeenAt: new Date(now).toISOString(),
                lastNotifiedAt: null,
            };
            notifications.push(
                enqueueNotification(
                    next,
                    siteId,
                    { ...item, kind: 'alert' },
                    now,
                ),
            );
            continue;
        }

        previous.severity = item.severity;
        previous.message = item.message;
        previous.lastSeenAt = new Date(now).toISOString();
        const hasPending = owned.pending.some(
            (task) => task.key === item.key && task.kind === 'alert',
        );
        const lastNotifiedAt = previous.lastNotifiedAt
            ? Date.parse(previous.lastNotifiedAt)
            : Number.NaN;
        if (
            !hasPending &&
            Number.isFinite(lastNotifiedAt) &&
            now - lastNotifiedAt >= ALERT_COOLDOWN_MS
        ) {
            notifications.push(
                enqueueNotification(
                    next,
                    siteId,
                    { ...item, kind: 'alert' },
                    now,
                ),
            );
        }
    }
    next.updatedAt = new Date(now).toISOString();
    return { state: next, notifications };
}

export function dueNotifications(state, now = Date.now()) {
    requireState(state);
    return Object.values(state.sites).flatMap((owned) =>
        owned.pending.filter((task) => Date.parse(task.nextAttemptAt) <= now),
    );
}

function historyRecord(task, now, status, error = null) {
    return {
        id: task.id,
        siteId: task.siteId,
        key: task.key,
        kind: task.kind,
        severity: task.severity,
        message: task.message,
        occurredAt: task.occurredAt,
        completedAt: new Date(now).toISOString(),
        attempts: task.attempts + 1,
        status,
        error,
    };
}

export function markNotificationDelivered(state, id, now = Date.now()) {
    requireState(state);
    const next = structuredClone(state);
    for (const owned of Object.values(next.sites)) {
        const index = owned.pending.findIndex((task) => task.id === id);
        if (index === -1) continue;
        const [task] = owned.pending.splice(index, 1);
        if (task.kind === 'alert' && owned.alerts[task.key]) {
            owned.alerts[task.key].lastNotifiedAt = new Date(now).toISOString();
        }
        owned.deliveryHistory.push(historyRecord(task, now, 'delivered'));
        owned.deliveryHistory =
            owned.deliveryHistory.slice(-deliveryHistoryLimit);
        next.updatedAt = new Date(now).toISOString();
        return next;
    }
    throw new Error(`Unknown notification: ${id}`);
}

export function markNotificationFailed(
    state,
    id,
    error,
    now = Date.now(),
    retryMs = 60_000,
) {
    requireState(state);
    if (!Number.isFinite(retryMs) || retryMs < 1_000) {
        throw new TypeError('retryMs must be at least one second');
    }
    const next = structuredClone(state);
    for (const owned of Object.values(next.sites)) {
        const index = owned.pending.findIndex((task) => task.id === id);
        if (index === -1) continue;
        const task = owned.pending[index];
        task.attempts += 1;
        task.lastError = String(error).slice(0, 300);
        if (task.attempts >= maximumDeliveryAttempts) {
            owned.pending.splice(index, 1);
            owned.deliveryHistory.push(
                historyRecord(task, now, 'exhausted', task.lastError),
            );
            owned.deliveryHistory =
                owned.deliveryHistory.slice(-deliveryHistoryLimit);
            owned.deliveryFailures ??= [];
            owned.deliveryFailures = [
                ...owned.deliveryFailures.filter(
                    (failure) => failure.id !== task.id,
                ),
                historyRecord(task, now, 'exhausted', task.lastError),
            ].slice(-deliveryHistoryLimit);
        } else {
            task.nextAttemptAt = new Date(now + retryMs).toISOString();
        }
        next.updatedAt = new Date(now).toISOString();
        return { state: next, task };
    }
    throw new Error(`Unknown notification: ${id}`);
}
