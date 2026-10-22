import { buildBackend } from './backend';
import { buildUi } from './ui';
import { ChildProcess } from '@bcms/selfhosted-utils/child-process';

export async function createMainDockerImage() {
    await buildBackend();
    await buildUi();
    await ChildProcess.advancedExec(
        `docker build . --platform linux/amd64 -t ghcr.io/bcms/cms:latest`,
        {
            cwd: process.cwd(),
            onChunk(type, chunk) {
                process[type].write(chunk);
            },
        },
    ).awaiter;
    await ChildProcess.advancedExec(
        `docker build . -f Dockerfile.storefront --platform linux/amd64 -t ghcr.io/bcms/cms-storefront:latest`,
        {
            cwd: process.cwd(),
            onChunk(type, chunk) {
                process[type].write(chunk);
            },
        },
    ).awaiter;
}
