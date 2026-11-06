import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createSiteProvisioningJob } from './jobs';

test('job attempts every five seconds, prevents overlap, and clears its timer on close', async context => {
    context.mock.timers.enable({ apis: ['setInterval'] });
    const app = Fastify();
    let claims = 0;
    let finish: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const job = createSiteProvisioningJob({
        async claim() { claims++; await blocked; return null; },
        async complete() { return true; }, async defer() { return true; },
    }, async () => { throw new Error('no claimed site'); });
    await new Promise<void>((resolve, reject) => job.initialize({ fastify: app, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    context.mock.timers.tick(5000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claims, 1);
    context.mock.timers.tick(10000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claims, 1);
    finish(); await new Promise(resolve => setImmediate(resolve));
    context.mock.timers.tick(5000); await new Promise(resolve => setImmediate(resolve));
    assert.equal(claims, 2);
    await app.close();
    context.mock.timers.tick(10000); await new Promise(resolve => setImmediate(resolve));
    assert.equal(claims, 2);
});
