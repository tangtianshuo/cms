import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedFixture } from './owned-runtime.mjs';
const cmsRoot = fileURLToPath(new URL('../../', import.meta.url));
if (process.env.E2E_C4_MODE !== 'local') {
    const { validatePlatformLock } = await import(
        '../release/platform-lock.mjs'
    );
    const lockFile =
        process.env.E2E_PLATFORM_LOCK ||
        path.join(cmsRoot, 'docs/releases/platform-lock.json');
    try {
        validatePlatformLock(JSON.parse(fs.readFileSync(lockFile, 'utf8')));
    } catch {
        throw Error(
            'C4 formal acceptance BLOCKED: verified public OCI/preview identities and complete PlatformLock are required. Use E2E_C4_MODE=local only for the explicitly isolated local proof.',
        );
    }
    throw Error(
        'C4 formal acceptance BLOCKED: a format-valid lock alone is insufficient. Independently verify public artifacts and wildcard DNS/TLS through D1/D2 before running the full CMS publicRecord/preset publication case. This runner only executes the explicit local proof.',
    );
}
const report = await runOwnedFixture();
if (!report.assertionsPassed) {
    console.error(report.failure);
    process.exitCode = 1;
} else
    console.log(
        'PASS: owned local runtime assertions and cleanup. Evidence: ' +
            path.join(report.runRoot, 'evidence.json'),
    );
