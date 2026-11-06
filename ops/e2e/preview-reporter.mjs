import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { previewCaseNames } from './preview-acceptance.mjs';
const names = new Set(['PREVIEW', 'LOCAL_SAVED_RUNTIME', ...previewCaseNames]);
export default class PreviewReporter {
    cells = [];
    onTestEnd(test, result) {
        const name = test.title.match(/^\[([A-Z_]+)\]/)?.[1];
        if (!names.has(name)) return;
        const viewport = test.parent.project().name;
        if (!['desktop', 'mobile'].includes(viewport)) return;
        const templateId =
            process.env.E2E_SECTION_TEMPLATE ||
            process.env.STOREFRONT_E2E_TEMPLATE_ID;
        const version =
            process.env.STOREFRONT_E2E_TEMPLATE_VERSION ||
            (templateId === 'aeroframe' ? '1.0.4' : '1.0.1');
        const id = `${templateId}/${name === 'PREVIEW' ? (viewport === 'desktop' ? 'PREVIEW_DESKTOP' : 'PREVIEW_MOBILE') : name}`;
        this.cells.push({
            id,
            templateId,
            version,
            viewport,
            dimensions: test.parent.project().use.viewport,
            status:
                result.status === 'passed'
                    ? 'passed'
                    : result.status === 'skipped'
                      ? 'blocked'
                      : 'failed',
            reason:
                result.status === 'skipped'
                    ? 'Required runtime/publication prerequisite not supplied'
                    : result.status === 'passed'
                      ? 'Real browser assertions passed'
                      : 'Real browser assertion failed; inspect safe artifacts',
            artifacts: result.attachments
                .filter((item) => item.path)
                .map((item) => item.path),
            lockChecksum: process.env.STOREFRONT_E2E_LOCK_CHECKSUM || null,
            durationMs: result.duration,
        });
    }
    async onEnd() {
        if (!process.env.STOREFRONT_E2E_CELL_REPORT) return;
        await mkdir(path.dirname(process.env.STOREFRONT_E2E_CELL_REPORT), {
            recursive: true,
        });
        await writeFile(
            process.env.STOREFRONT_E2E_CELL_REPORT,
            JSON.stringify(
                {
                    scope: process.env.STOREFRONT_E2E_LOCK_CHECKSUM
                        ? 'lock-bound-browser-results'
                        : 'local-b3-not-acceptance',
                    cells: this.cells,
                },
                null,
                2,
            ),
        );
    }
}
