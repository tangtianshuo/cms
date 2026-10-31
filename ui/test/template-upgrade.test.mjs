import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/views/dashboard/presets.tsx', import.meta.url), 'utf8');

test('template management requests an upgrade preview before adopting a public version', () => {
    assert.match(source, /\/api\/v4\/presets\/upgrade/);
    assert.match(source, /upgradePreview\.value\?\.compatible === true/);
    assert.match(source, /requiresNewInstallation/);
    assert.match(source, /templateImpact/);
    assert.match(source, /contentImpact/);
});

test('template adoption remains explicit and uses the selected version identity', () => {
    assert.match(source, /mode: 'adopt'/);
    assert.match(source, /presetVersion: selected\.value\.version/);
    assert.match(source, /manifestChecksum: selected\.value\.manifestChecksum/);
    assert.match(source, /expectedUpdatedAt: site\.value\.updatedAt/);
    assert.match(source, /adoptSelected/);
});
