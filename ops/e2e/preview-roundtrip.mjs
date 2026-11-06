import { spawnSync } from 'node:child_process';

const foundationOnly =
    process.argv.length === 3 && process.argv[2] === '--foundation';
if (process.argv.length > 2 && !foundationOnly)
    throw new Error('Usage: node ops/e2e/preview-roundtrip.mjs [--foundation]');
const result = spawnSync(
    'npx',
    [
        'playwright',
        'test',
        '--config',
        'ops/e2e/playwright.config.mjs',
        'ops/e2e/preview.spec.mjs',
    ],
    { stdio: 'inherit' },
);
const foundationPassed = !result.error && result.status === 0;
console.log(
    JSON.stringify({
        evidenceType: 'local-browser-foundation-not-acceptance',
        foundationPassed,
        overallB3Complete: false,
        incomplete: [
            'new-version-two-template-matrix',
            'unsaved-live-draft',
            'page-image-richtext',
            'save-publish-consistency',
            'deployment-lock-and-edge-checks',
            'credential-safe-failure-trace',
        ],
    }),
);
// The default acceptance entrypoint must stay nonzero until the real B2/B7 matrix
// is implemented. Explicit local foundation mode never produces AcceptanceEvidence.
process.exitCode = foundationPassed && foundationOnly ? 0 : result.status || 1;
