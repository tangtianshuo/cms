import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { keyValueStore } from '../key-value-store';
import { MediaFactory } from './factory';
import { MediaType } from './models/main';
import { copyRepository } from '../resource-shares/visibility';
import { claimMediaDeletion, MediaRetentionError, pinReleaseMedia } from './retention';

test.after(() => keyValueStore.destroy());
const options = { skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 30000 };
const payload = (...ids: string[]) => JSON.stringify({ pages: ids.map(id => ({ image: `https://cms.invalid/api/v4/media/${id}/bin/image.png` })) });

async function setup(context: TestContext) {
    const app = Fastify();
    await app.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database: `media_pin_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    context.after(async () => { await app.mongo.db?.dropDatabase(); await app.close(); });
    for (const repo of [Repo.siteInstallation, Repo.storefrontRelease, Repo.media]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app,
            next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    const image = (name: string) => Repo.media.add(MediaFactory.create({ userId: 'publisher', type: MediaType.IMG,
        mimetype: 'image/png', size: 10, name, isInRoot: true, hasChildren: false, parentId: '', altText: '', caption: '', width: 1, height: 1 }));
    return { image, raw: copyRepository('Media').raw };
}

for (const failure of ['missing', 'deleting']) {
    test(`a later ${failure} image leaves no orphaned pins on an earlier image`, options, async context => {
        const { image, raw } = await setup(context);
        const first = await image('first');
        const second = failure === 'missing' ? randomUUID() : (await image('second'))._id;
        if (failure === 'deleting') await raw.updateOne({ _id: second }, { $set: { deletionPending: true } });
        await assert.rejects(() => pinReleaseMedia(payload(first._id, second), 'failed-release'), MediaRetentionError);
        assert.deepEqual((await raw.findOne({ _id: first._id }))?.retentionPins || [], []);
        await claimMediaDeletion([first._id]);
        assert.equal((await raw.findOne({ _id: first._id }))?.deletionPending, true);
    });
}

test('a failed attempt preserves existing successful release pins', options, async context => {
    const { image, raw } = await setup(context);
    const first = await image('first');
    await pinReleaseMedia(payload(first._id), 'published-release');
    await assert.rejects(() => pinReleaseMedia(payload(first._id, randomUUID()), 'failed-release'), MediaRetentionError);
    assert.deepEqual((await raw.findOne({ _id: first._id }))?.retentionPins, ['published-release']);
    await assert.rejects(() => claimMediaDeletion([first._id]), MediaRetentionError);
});

test('a failing concurrent attempt cannot remove a confirmed pin with the same release ID', options, async context => {
    const { image, raw } = await setup(context);
    const first = await image('first');
    const missing = randomUUID();
    const updateOne = raw.updateOne.bind(raw);
    let releaseFailure!: () => void;
    let reachedMissing!: () => void;
    const blocked = new Promise<void>(resolve => { releaseFailure = resolve; });
    const missingReached = new Promise<void>(resolve => { reachedMissing = resolve; });
    context.mock.method(raw, 'updateOne', async (filter: any, update: any, ...rest: any[]) => {
        if (JSON.stringify(filter).includes(missing)) { reachedMissing(); await blocked; }
        return updateOne(filter, update, ...rest);
    });
    const failed = assert.rejects(() => pinReleaseMedia(payload(first._id, missing), 'shared-release'), MediaRetentionError);
    try {
        await missingReached;
        await pinReleaseMedia(payload(first._id), 'shared-release');
    } finally { releaseFailure(); }
    await failed;
    assert.deepEqual((await raw.findOne({ _id: first._id }))?.retentionPins, ['shared-release']);
    await assert.rejects(() => claimMediaDeletion([first._id]), MediaRetentionError);
});

test('an unknown write outcome conservatively retains every acquired media lock', options, async context => {
    const { image, raw } = await setup(context);
    const first = await image('first');
    const second = await image('second');
    const updateOne = raw.updateOne.bind(raw);
    context.mock.method(raw, 'updateOne', async (filter: any, update: any, ...rest: any[]) => {
        const result = await updateOne(filter, update, ...rest);
        if (JSON.stringify(filter).includes(second._id)) throw new Error('Mongo acknowledgement lost');
        return result;
    });
    await assert.rejects(() => pinReleaseMedia(payload(first._id, second._id), 'uncertain-release'), /acknowledgement lost/);
    for (const id of [first._id, second._id]) {
        assert.ok((await raw.findOne({ _id: id }))?.retentionPins?.length);
        await assert.rejects(() => claimMediaDeletion([id]), MediaRetentionError);
    }
});
