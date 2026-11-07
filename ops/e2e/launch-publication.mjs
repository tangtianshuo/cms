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

export function verifyPublicProduct({
    status,
    body,
    marker,
    otherMarker,
    price,
    replacedPrice,
}) {
    verifyPublicResponse({ status, body, marker, otherMarker });
    const prices = [
        ...body.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi),
    ].map((m) => m[1].replace(/<[^>]*>/g, ' ').trim());
    const exact = (value) => new RegExp('(^|[^0-9])' + value + '([^0-9]|$)');
    assert.ok(
        prices.some((text) => exact(price).test(text)),
        'Expected product price absent',
    );
    assert.ok(
        !prices.some((text) => exact(replacedPrice).test(text)),
        'Replaced product price remains',
    );
    return true;
}

export function verifyRollbackRevision(restored, latest) {
    assert.ok(
        Number.isSafeInteger(restored) &&
            Number.isSafeInteger(latest) &&
            restored > latest,
        'Rollback authority revision must exceed latest active revision',
    );
}
