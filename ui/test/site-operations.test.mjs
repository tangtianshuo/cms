import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const studio = fs.readFileSync(new URL('../src/views/dashboard/studio.tsx', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../src/sdk/handlers/studio.ts', import.meta.url), 'utf8');

test('website settings exposes SEO, sharing, analytics and unavailable contact form state', () => {
    for (const label of ['搜索引擎标题', '搜索引擎描述', '社交分享图片', '网站图标', '统计工具 ID']) assert.match(studio, new RegExp(label));
    assert.match(studio, /暂未配置邮件投递服务/);
    assert.match(handler, /operations\?: SiteOperations/);
});

test('operations panel keeps infrastructure details behind a site-scoped status endpoint', () => {
    const navigation = fs.readFileSync(new URL('../src/layouts/dashboard/navigation.ts', import.meta.url), 'utf8');
    const panel = fs.readFileSync(new URL('../src/components/studio/site-operations.tsx', import.meta.url), 'utf8');
    assert.match(navigation, /运营状态/);
    assert.match(panel, /\/api\/v4\/presets\/operations/);
    assert.match(panel, /域名与 HTTPS/);
    assert.match(panel, /备份与恢复/);
    assert.match(panel, /最近发布/);
});
