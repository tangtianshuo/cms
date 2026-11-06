// Actual Vue domain view, isolated deterministic HTTP adapter states.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('@playwright/test');
const { createServer } = await import(
    path.join(root, 'ui/node_modules/vite/dist/node/index.js')
);
const entry = `
import '/src/styles/_main.scss';
import {createApp} from 'vue';
import {createI18n} from 'vue-i18n';
import View from '/src/views/dashboard/domains.tsx';
import {en} from '/src/i18n/locales/en.ts';
const item={_id:'d1',hostname:'default.example.com',enabled:true,isPrimary:true,platformOwned:true,ownershipStatus:'verified',connectionStatus:'ready',certificateStatus:'ready',lastCheckedAt:Date.now(),lastSuccessAt:Date.now()};
window.fixture={items:[item,{...item,_id:'d2',hostname:'custom.example.com',isPrimary:false,platformOwned:false,connectionStatus:'error',certificateStatus:'pending',lastSuccessAt:0}],bindingRevision:1,guidance:{entryHost:'edge.example.com',entryIp:'203.0.113.10',challengePath:'/.well-known/cms-domain-challenge'},gateway:{status:'ready',route:{status:'active',revision:1,releaseId:'r1',host:'default.example.com',health:'healthy'},domains:[],operation:null}};
window.bcms={confirm:async()=>true,sdk:{context:{context:{admin:true,siteId:'selected'}},send:async input=>{if(input.method==='POST'){window.fixture.gateway.operation={status:'pending',error:null};return {status:'pending'};}return structuredClone(window.fixture);}}};
const app=createApp(View);app.use(createI18n({legacy:false,locale:'en',messages:{en}}));app.directive('cy',{});app.mount('#app');
`;
process.chdir(path.join(root, 'ui'));
let browser;
const server = await createServer({
    configFile: path.join(root, 'ui/vite.config.ts'),
    root: path.join(root, 'ui'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
        {
            name: 'c4-domain-fixture',
            resolveId(id) {
                if (id === 'virtual:c4-domain') return '\0virtual:c4-domain';
            },
            load(id) {
                if (id === '\0virtual:c4-domain') return entry;
            },
            configureServer(server) {
                server.middlewares.use(
                    '/c4-domain-fixture',
                    async (_req, res) => {
                        res.setHeader('content-type', 'text/html');
                        res.end(
                            await server.transformIndexHtml(
                                '/c4-domain-fixture',
                                '<html><body class="bcmsBody"><div id="app"></div><script type="module" src="/@id/virtual:c4-domain"></script></body></html>',
                            ),
                        );
                    },
                );
            },
        },
    ],
});
try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/c4-domain-fixture`,
    );
    await page.getByText('edge.example.com', { exact: true }).waitFor();
    const custom = page
            .locator('article')
            .filter({ hasText: 'custom.example.com' }),
        fixed = page
            .locator('article')
            .filter({ hasText: 'default.example.com' });
    assert.equal(
        await custom
            .getByRole('button', { name: 'Set as primary' })
            .isDisabled(),
        true,
    );
    assert.equal(
        await fixed
            .getByRole('button', { name: 'Unbind domain', exact: true })
            .isDisabled(),
        true,
    );
    await custom
        .getByText('HTTPS certificate is not ready. Connection is incomplete.')
        .waitFor();
    await page.evaluate(() => {
        window.fixture.items[1].certificateStatus = 'ready';
        window.fixture.items[1].connectionStatus = 'ready';
        window.fixture.items[1].lastSuccessAt = Date.now();
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll('article')]
                .find((x) => x.textContent.includes('custom.example.com'))
                .querySelectorAll('button')[1].disabled === false,
    );
    await custom.getByRole('button', { name: 'Set as primary' }).click();
    await page
        .getByRole('status')
        .filter({ hasText: 'Domain change is being verified.' })
        .waitFor();
    assert.equal(
        await custom
            .getByRole('button', { name: 'Set as primary' })
            .isDisabled(),
        true,
    );
    await page.evaluate(() => {
        window.fixture.gateway.operation.status = 'failed';
    });
    await page
        .getByText(
            'Domain change failed. The previous address is retained; check the connection and retry.',
        )
        .waitFor();
    assert.equal(
        await fixed
            .getByRole('button', { name: 'Set as primary' })
            .isDisabled(),
        true,
    );
    await page.addStyleTag({content:'html, body { height: auto; overflow: visible; } #app { padding: 16px; }'});
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
    );
    const output = process.env.E2E_DOMAIN_UI_OUTPUT && path.resolve(root, process.env.E2E_DOMAIN_UI_OUTPUT);
    if (output) {
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({
            path: path.join(output, 'domains-mobile.png'),
            fullPage: true,
        });
    }
    assert.deepEqual(errors, []);
    console.log(
        'PASS: actual domain view DNS guidance, incomplete TLS, protected default, pending/failure states and mobile width.',
    );
} finally {
    if (browser) await browser.close();
    await server.close();
}
