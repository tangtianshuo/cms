import assert from 'node:assert/strict';
import test from 'node:test';
import { domainActions, connectionRecords } from './domain-state';
test('pending operations and incomplete certificate prevent primary success actions', () => {
    const record = {
        enabled: true,
        isPrimary: false,
        platformOwned: false,
        ownershipStatus: 'verified',
        connectionStatus: 'ready',
        certificateStatus: 'pending',
    };
    assert.equal(domainActions(record, false).primary, false);
    assert.equal(
        domainActions({ ...record, certificateStatus: 'ready' }, false).primary,
        true,
    );
    assert.equal(
        domainActions({ ...record, certificateStatus: 'ready' }, true).primary,
        false,
    );
    assert.equal(
        domainActions({ ...record, platformOwned: true }, false).remove,
        false,
    );
    assert.equal(
        domainActions({ ...record, isPrimary: true }, false).disable,
        false,
    );
});
test('copy guidance includes only actual DNS values', () => {
    assert.equal(connectionRecords({ entryHost: '', entryIp: '' }), '');
    assert.equal(
        connectionRecords({ entryHost: 'edge.example.com', entryIp: '' }),
        'CNAME edge.example.com',
    );
});
