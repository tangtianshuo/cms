// Real Vue component with a bounded HTTP adapter: tests UI semantics and download bytes.
// Full authenticated CMS/Gateway coverage is executed separately by the local launch fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { createServer } = await import(
    path.join(root, 'ui/node_modules/vite/dist/node/index.js')
);
const entry = `import '/src/styles/_main.scss';import {createApp} from 'vue';import View from '/src/views/dashboard/leads.tsx';
window.bcms={sdk:{context:{context:{admin:true}},send:async config=>{const response=await fetch('/fixture'+config.url,{method:config.method||'GET',headers:{'content-type':'application/json','authorization':'Bearer local-ui-proof','x-bcms-workspace':'workspace-a','x-bcms-site':'site-a'},...(config.data?{body:JSON.stringify(config.data)}:{})});if(!response.ok)throw Error('Scoped export unavailable');return config.responseType==='blob'?response.blob():response.json();}}};createApp(View).mount('#app');`;
let item = {
    _id: 'lead-a',
    name: 'D1 Contact',
    message: 'Unique D1 lead',
    source: 'contact',
    status: 'new',
    assignedTo: '',
    createdAt: Date.now(),
};
let requests = [];
process.chdir(path.join(root, 'ui'));
const server = await createServer({
    configFile: path.join(root, 'ui/vite.config.ts'),
    root: path.join(root, 'ui'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'd1-leads',
            resolveId: (id) =>
                id === 'virtual:d1-leads' ? '\0virtual:d1-leads' : undefined,
            load: (id) => (id === '\0virtual:d1-leads' ? entry : undefined),
            configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    if (req.url === '/d1-leads') {
                        res.setHeader('content-type', 'text/html');
                        res.end(
                            await server.transformIndexHtml(
                                '/d1-leads',
                                '<html><body class="bcmsBody"><div id="app"></div><script type="module" src="/@id/virtual:d1-leads"></script></body></html>',
                            ),
                        );
                        return;
                    }
                    if (!req.url.startsWith('/fixture/api/v4/leads'))
                        return next();
                    requests.push({
                        method: req.method,
                        url: req.url,
                        workspace: req.headers['x-bcms-workspace'],
                        site: req.headers['x-bcms-site'],
                        authenticated:
                            req.headers.authorization ===
                            'Bearer local-ui-proof',
                    });
                    if (req.url.endsWith('/export')) {
                        res.setHeader('content-type', 'text/csv');
                        res.end(
                            'name,assignedTo,status\nD1 Contact,' +
                                item.assignedTo +
                                ',' +
                                item.status +
                                '\n',
                        );
                        return;
                    }
                    if (req.method === 'POST') {
                        let bytes = '';
                        for await (const chunk of req) bytes += chunk;
                        item = { ...item, ...JSON.parse(bytes) };
                    }
                    res.setHeader('content-type', 'application/json');
                    res.end(
                        JSON.stringify(
                            req.method === 'POST'
                                ? { item }
                                : { items: [item] },
                        ),
                    );
                });
            },
        },
    ],
});
let browser;
const failures = [];
try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0] + 'd1-leads');
    try {
        await page
            .getByLabel('D1 Contact 负责人', { exact: true })
            .fill('operator-a', { timeout: 2500 });
        await page
            .getByRole('button', { name: '保存负责人', exact: true })
            .click();
        await page.waitForFunction(
            () =>
                document.querySelector('input[aria-label="D1 Contact 负责人"]')
                    ?.value === 'operator-a',
        );
        assert.equal(item.assignedTo, 'operator-a');
    } catch {
        failures.push('Assignment control must persist assignedTo');
    }
    try {
        const download = page.waitForEvent('download', { timeout: 2500 });
        await page
            .getByRole('button', { name: '导出 CSV', exact: true })
            .click();
        const file = await download;
        const stream = await file.createReadStream();
        let content = '';
        for await (const chunk of stream) content += chunk;
        assert.ok(content.includes('D1 Contact'));
        assert.equal(file.suggestedFilename(), 'leads.csv');
        assert.ok(
            requests.some(
                (r) =>
                    r.url.endsWith('/export') &&
                    r.workspace === 'workspace-a' &&
                    r.site === 'site-a' &&
                    r.authenticated,
            ),
        );
    } catch {
        failures.push(
            'CSV must download actual authenticated selected-site bytes',
        );
    }
    assert.deepEqual(failures, []);
    console.log(
        'PASS actual leads component: assignment persisted and scoped authenticated CSV bytes downloaded',
    );
} finally {
    await browser?.close();
    await server.close();
}
