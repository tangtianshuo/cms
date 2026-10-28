import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

// Resolve the same TS modules Vite resolves in the app, without a browser.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && context.parentURL) {
            const url = new URL(`${specifier}.ts`, context.parentURL);
            if (existsSync(url)) return { url: url.href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
const { errorMessage } = await import('../src/components/workspace/common.ts');

test('login rejection explains the credentials problem before the generic 401 fallback', () => {
    const message = errorMessage({
        status: 401,
        message: 'Wrong email and/or password',
    });
    assert.match(message, /邮箱.*密码/);
    assert.doesNotMatch(message, /Wrong|过期/);
});

test('network, timeout, session and permission failures have distinct actionable reasons', () => {
    const cases = [
        [{ status: -1, message: 'Network Error' }, /网络.*连接/],
        [
            { code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' },
            /超时/,
        ],
        [{ status: 401 }, /登录.*过期|尚未登录/],
        [
            { status: 403, message: 'Workspace is read only' },
            /工作区.*只读.*管理员/,
        ],
        [{ status: 413 }, /文件.*大小/],
    ];
    for (const [cause, reason] of cases)
        assert.match(errorMessage(cause), reason);
});

test('validation identifies the invalid page path and the accepted format', () => {
    const message = errorMessage({ status: 400, message: 'Invalid page path' });
    assert.match(message, /路径/);
    assert.match(message, /小写.*数字/);
    assert.match(message, /\/about-us/);
});

test('title conflict explains its workspace, group and language scope', () => {
    const message = errorMessage({
        status: 409,
        message:
            'An entry with this normalized title already exists in this group and language',
    });
    assert.match(message, /工作区.*分组.*语言.*标题/);
    assert.match(message, /修改标题|更换分组/);
    assert.doesNotMatch(message, /normalized|E11000/);
});

test('release validation preserves the exact field and page that need correction', () => {
    assert.match(
        errorMessage('Invalid required field product.price (entry-123)'),
        /商品.*price.*entry-123/,
    );
    assert.match(
        errorMessage('Missing content for 关于我们 in language zh-CN'),
        /关于我们.*zh-CN/,
    );
    assert.match(
        errorMessage('Duplicate page path: /about-us'),
        /路径.*\/about-us.*重复/,
    );
});

test('known Chinese errors are preserved without duplicating their text', () => {
    const message = '页面标题不能为空，请填写后再保存。';
    assert.equal(errorMessage(new Error(message)), message);
});

test('unknown errors remain honest and do not expose stacks, tokens or database details', () => {
    for (const cause of [
        null,
        undefined,
        {},
        'toString',
        '__proto__',
        new Error('E11000 db.password=secret'),
        { status: 500, message: 'SQL failed token=secret' },
    ]) {
        const message = errorMessage(cause);
        assert.match(message, /原因|异常/);
        assert.match(message, /重试|管理员/);
        assert.doesNotMatch(
            message,
            /secret|SQL|E11000|undefined|object Object/,
        );
    }
});

test('Axios response data keeps the specific reason instead of its generic status text', () => {
    assert.match(
        errorMessage({
            message: 'Request failed with status code 400',
            response: { status: 400, data: { message: 'Invalid hostname' } },
        }),
        /域名.*https/,
    );
});

test('domain diagnostics explain each failed check instead of hiding combined causes', () => {
    const message = errorMessage(
        'TXT ownership record missing or incorrect; HTTPS challenge signature did not match the configured storefront',
    );
    assert.match(message, /TXT.*记录.*验证值/);
    assert.match(message, /HTTPS.*网关/);
    assert.doesNotMatch(message, /missing|signature did not match/);
});

test('entry validation identifies the language and field requiring a value', () => {
    const message = errorMessage(
        '[body.meta.zh-CN.props.price.data] -> Property is required and must contain a value',
    );
    assert.match(message, /zh-CN.*price.*必填/);
    assert.doesNotMatch(message, /body\.meta|Property is required/);
});

test('schema type errors explain which input has the wrong format', () => {
    const message = errorMessage(
        "body: Type mismatch of property 'email'. Expected 'string' but got 'number'.",
    );
    assert.match(message, /邮箱.*文本/);
    assert.doesNotMatch(message, /Type mismatch/);
});

test('template import conflicts identify the incompatible field', () => {
    assert.match(
        errorMessage('Field price is incompatible'),
        /price.*类型.*必填/,
    );
    assert.match(errorMessage('revision_conflict'), /发布版本.*刷新/);
});

test('deployment failure codes explain the failed stage and a useful next step', () => {
    const cases = [
        ['CANDIDATE_CREATE_FAILED', /准备.*部署.*管理员.*镜像/],
        ['CANDIDATE_START_FAILED', /启动.*管理员.*运行/],
        ['CANDIDATE_UNHEALTHY', /健康检查.*首页.*管理员/],
        ['ROUTE_SWITCH_FAILED', /切换.*刷新.*状态/],
        ['WORKER_INTERNAL_ERROR', /发布服务.*异常.*刷新.*状态/],
    ];
    const messages = new Set();
    for (const [code, expected] of cases) {
        const message = errorMessage(code);
        assert.match(message, expected);
        assert.doesNotMatch(message, /CANDIDATE_|ROUTE_|WORKER_/);
        messages.add(message);
    }
    assert.equal(messages.size, cases.length);
    assert.match(errorMessage('UNRECOGNIZED_DEPLOYMENT_FAILURE'), /未能获取具体.*原因/);
});

test('shared notifications translate warning and error paths, including push', async () => {
    const { NotificationService } = await import(
        '../src/services/notification.ts'
    );
    const notifications = new NotificationService();
    const messages = [];
    notifications.register((type, content) => messages.push({ type, content }));
    notifications.warning('Wrong email and/or password');
    notifications.error('Invalid page path');
    notifications.push('error', 'Workspace is read only');
    assert.match(messages[0].content, /邮箱.*密码/);
    assert.match(messages[1].content, /路径/);
    assert.match(messages[2].content, /只读/);
    notifications.success('已保存。');
    assert.deepEqual(messages[3], { type: 'success', content: '已保存。' });
});
