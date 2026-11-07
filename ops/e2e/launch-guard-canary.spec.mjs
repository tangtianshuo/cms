import { test } from './browser-fixture.mjs';
// This intentionally fails only during the owned harness's security regression.
// The harness requires nonzero and verifies retained artifacts contain no canary.
test('[PUBLISH] guard failure keeps safe authenticated evidence', async ({
    page,
    traceSteps,
}) => {
    test.skip(
        process.env.STOREFRONT_E2E_GUARD_CANARY !== '1',
        'Controlled guard probe only',
    );
    await page.goto('/d/studio');
    traceSteps.step('controlled-failure');
    await page.evaluate(async (value) => {
        try {
            await fetch(
                '/api/v4/presets/releases/gateway?probe=' +
                    encodeURIComponent(value),
            );
        } catch {
            /* guard abort */
        }
    }, process.env.STOREFRONT_E2E_PRIVATE_CANARY);
});
