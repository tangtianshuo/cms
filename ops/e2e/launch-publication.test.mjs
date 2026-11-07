import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublicResponse } from './launch-publication.mjs';
test('public 200 without this run marker or with other-site content fails', () => {
    for (const body of ['old homepage', 'D1-A D1-B'])
        assert.throws(() =>
            verifyPublicResponse({
                status: 200,
                body,
                marker: 'D1-A',
                otherMarker: 'D1-B',
            }),
        );
    assert.throws(() =>
        verifyPublicResponse({
            status: 503,
            body: 'D1-A',
            marker: 'D1-A',
            otherMarker: 'D1-B',
        }),
    );
    assert.equal(
        verifyPublicResponse({
            status: 200,
            body: '<h1>D1-A</h1>',
            marker: 'D1-A',
            otherMarker: 'D1-B',
        }),
        true,
    );
});

import {
    verifyPublicProduct,
    verifyRollbackRevision,
} from './launch-publication.mjs';
test('product versions reject stale price, replaced marker and an unchanged rollback revision', () => {
    verifyRollbackRevision(4, 3);
    assert.throws(() => verifyRollbackRevision(3, 3));
    assert.throws(() => verifyRollbackRevision(2, 3));
    const good = {
        status: 200,
        body: '<main><h1>first</h1><strong>127</strong></main>',
        marker: 'first',
        otherMarker: 'second',
        price: 127,
        replacedPrice: 173,
    };
    assert.equal(verifyPublicProduct(good), true);
    for (const change of [
        { body: '<h1>first</h1><strong>173</strong>' },
        { body: '<h1>first second</h1><strong>127</strong>' },
        { body: '<h1>first</h1><strong>127 173</strong>' },
    ])
        assert.throws(() => verifyPublicProduct({ ...good, ...change }));
});
