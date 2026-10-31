import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNavigation, type NavigationNode } from './navigation';

test('normalizes navigation in stable input order and preserves disabled nested nodes', () => {
    const result = normalizeNavigation([
        { id: 'group', label: 'Explore', enabled: true, children: [
            { id: 'about', label: 'About', href: '/about', enabled: false, children: [] },
        ] },
        { label: 'Contact', path: '/contact' },
    ]);
    assert.deepEqual(result.map(node => node.label), ['Explore', 'Contact']);
    assert.equal(result[0].children[0].enabled, false);
    assert.equal(result[0].children[0].href, '/about');
    assert.equal(result[1].href, '/contact');
    assert.equal(result[1].children.length, 0);
});

test('legacy flat links become one-level navigation nodes', () => {
    const result = normalizeNavigation([{ label: 'Home', path: '/' }, { label: 'Story', path: '/story' }]);
    assert.deepEqual(result.map(({ label, href, children, enabled }) => ({ label, href, children, enabled })), [
        { label: 'Home', href: '/', children: [], enabled: true },
        { label: 'Story', href: '/story', children: [], enabled: true },
    ]);
});

test('rejects duplicate internal links at any depth', () => {
    assert.throws(() => normalizeNavigation([
        { label: 'One', href: '/same' },
        { label: 'More', children: [{ label: 'Two', href: '/same' }] },
    ]), /duplicate.*navigation link/i);
});

test('rejects duplicate external links as well as internal links', () => {
    assert.throws(() => normalizeNavigation([
        { label: 'Docs', href: 'https://example.com/docs' },
        { label: 'Guide', href: 'https://example.com/docs' },
    ]), /duplicate.*navigation link/i);
});

test('rejects links that do not resolve to a published page', () => {
    assert.throws(() => normalizeNavigation([
        { label: 'Draft', href: '/draft' },
    ], { publishedPaths: ['/'] }), /published page/i);
});

test('accepts a group without a link and keeps external links', () => {
    const result: NavigationNode[] = normalizeNavigation([
        { label: 'Resources', children: [{ label: 'Docs', href: 'https://example.com/docs' }] },
    ], { publishedPaths: ['/'] });
    assert.equal(result[0].href, undefined);
    assert.equal(result[0].children[0].href, 'https://example.com/docs');
});
