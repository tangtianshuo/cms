import { test, expect } from './browser-fixture.mjs';

// Early B3 foundation only. No draft/public roundtrip or formal acceptance claim.
test('real login reaches the selected content workbench', async ({ page }) => {
    await page.goto('/d/studio');
    await expect(
        page.getByRole('heading', { name: '工作台', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: '登录', exact: true }),
    ).toHaveCount(0);
});

test('empty approved registry exposes renderer unavailable without an iframe', async ({
    page,
    installation,
}) => {
    const descriptor = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname ===
            '/api/v4/storefront/preview-runtime',
    );
    await page.goto('/d/presets/site-preview');
    const response = await descriptor;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({
        status: 'unavailable',
        configured: true,
        runtime: null,
        templateId: installation.templateId,
        templateVersion: installation.templateVersion,
    });
    await expect(page.getByRole('alert')).toHaveText('该模板版本尚未提供预览');
    await expect(page.locator('iframe')).toHaveCount(0);
});
