import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDomain, publicAddress } from './verification';
import { challengeSignature, tokenDigest } from './service';

test('SSRF filter rejects private, loopback, link local, multicast and IPv4 mapped IPv6', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2001:0db8::1', '2001:0000::1', '2::1']) assert.equal(publicAddress(ip), false, ip);
    assert.equal(publicAddress('1.1.1.1'), true);
    assert.equal(publicAddress('2606:4700:4700::1111'), true);
});

test('TXT ownership and signed HTTPS challenge work behind a proxy without matching origin IP', async () => {
    const record = { hostname: 'shop.test', verificationTokenHash: tokenDigest('cms-verify=token') };
    const options = { secret: 'secret', resolveTxt: async () => [['cms-verify=', 'token']],
        lookup: async () => [{ address: '1.1.1.1', family: 4 }],
        request: async (host: string, address: string, nonce: string) => {
            assert.equal(host, 'shop.test'); assert.equal(address, '1.1.1.1');
            return challengeSignature(host, nonce, 'secret');
        } };
    assert.deepEqual(await checkDomain(record, options), { ownership: true, dns: true, https: true });
    const incorrect = await checkDomain(record, { ...options, resolveTxt: async () => [['wrong']] });
    assert.equal(incorrect.ownership, false);
    assert.equal(incorrect.https, true);
    const privateDns = await checkDomain(record, { ...options, lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
    assert.equal(privateDns.https, false);
    assert.match(privateDns.error!, /public/i);
    const tlsError = await checkDomain(record, { ...options, request: async () => { throw new Error('certificate expired'); } });
    assert.equal(tlsError.ownership, true); assert.equal(tlsError.https, false);
    assert.match(tlsError.error!, /certificate/i);
    const redirect = await checkDomain(record, { ...options, request: async () => '<html>Moved</html>' });
    assert.equal(redirect.https, false);
});

test('DNS timeout is bounded and keeps ownership independent of connection', { timeout: 6000 }, async () => {
    const started = Date.now();
    const result = await checkDomain({ hostname: 'shop.test', verificationTokenHash: tokenDigest('value') }, {
        secret: 'secret', resolveTxt: async () => [['value']], lookup: async () => new Promise(() => undefined),
    });
    assert.equal(result.ownership, true); assert.equal(result.https, false);
    assert.match(result.error!, /timed out/i);
    assert.ok(Date.now() - started < 5500);
});

test('IPv4 exclusions are precise CIDRs and retain adjacent public addresses', () => {
    for (const ip of ['192.0.0.1', '192.0.0.255', '192.0.2.1', '192.0.2.255', '192.88.99.1', '198.18.0.1', '198.19.255.255']) assert.equal(publicAddress(ip), false, ip);
    for (const ip of ['192.0.1.1', '192.0.3.1', '192.0.255.255', '192.1.0.1', '192.88.98.1', '192.88.100.1', '198.17.255.255', '198.20.0.1']) assert.equal(publicAddress(ip), true, ip);
});
