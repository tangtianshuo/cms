import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './main';

test('MCP protocol lists domain tools and forwards selected workspace headers', async (context) => {
    let request: any;
    const fastify = {
        async inject(options: any) {
            request = options;
            return {
                statusCode: 200,
                json: () => ({ items: [{ _id: 'workspace-a' }] }),
            };
        },
    } as never;
    const server = createMcpServer(fastify, 'Bearer test-jwt', {
        'x-bcms-workspace': 'workspace-a',
        'x-bcms-site': 'site-a',
    });
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mcp-test', version: '1.0.0' });
    context.after(async () => {
        (clientTransport as any)._otherTransport = undefined;
        (serverTransport as any)._otherTransport = undefined;
        await client.close();
        await server.close();
    });
    await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
    ]);

    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    assert.ok(names.has('storefront_release_publish'));
    assert.ok(names.has('site_domain_set_primary'));
    assert.ok(names.has('resource_share_copy'));
    assert.ok(names.has('media_file_upload'));
    assert.equal(
        tools.tools.find((tool) => tool.name === 'media_upload_token_request')
            ?.annotations?.readOnlyHint,
        false,
    );
    assert.equal(
        tools.tools.find(
            (tool) => tool.name === 'backup_restore_upload_token_request',
        )?.annotations?.readOnlyHint,
        false,
    );

    const result: any = await client.callTool({
        name: 'workspaces_list',
        arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.match(
        result.content[0].type === 'text' ? result.content[0].text : '',
        /workspace-a/,
    );
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, 'Bearer test-jwt');
    assert.equal(request.headers['x-bcms-workspace'], 'workspace-a');
    assert.equal(request.headers['x-bcms-site'], 'site-a');

    await client.callTool({
        name: 'media_file_upload',
        arguments: {
            token: 'single-use-token',
            fileName: 'hello.txt',
            mimeType: 'text/plain',
            fileBase64: 'aGVsbG8=',
        },
    });
    assert.equal(request.method, 'POST');
    assert.match(request.url, /token=single-use-token/);
    assert.match(
        request.headers['content-type'],
        /^multipart\/form-data; boundary=/,
    );
    assert.ok(request.payload.includes(Buffer.from('hello')));
    assert.ok(
        request.payload
            .toString('latin1')
            .includes(request.headers['content-type'].split('boundary=')[1]),
    );
});
