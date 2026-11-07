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
