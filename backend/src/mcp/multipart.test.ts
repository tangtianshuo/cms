import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultipartFile } from './multipart';

test('MCP file upload builds a multipart file field from base64 bytes', () => {
    const upload = createMultipartFile('avatar.png', 'image/png', 'aGVsbG8=');
    assert.match(upload.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(upload.body.includes(Buffer.from('hello')));
    assert.match(
        upload.body.toString('latin1'),
        /name="file"; filename="avatar\.png"/,
    );
});
