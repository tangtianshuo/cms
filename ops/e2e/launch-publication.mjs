import assert from 'node:assert/strict';
export function verifyPublicResponse({ status, body, marker, otherMarker }) {
    assert.equal(status, 200, 'Published public response must be healthy');
    assert.ok(
        marker && body.includes(marker),
        'Unique run/site marker absent from public response',
    );
    assert.ok(
        otherMarker && !body.includes(otherMarker),
        'Other site content leaked',
    );
    return true;
}
