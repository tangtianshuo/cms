// Only authorized CMS media capability routes, with an invocation-owned throwaway key.
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function httpsMediaFixture({ privateRoot, cms, port = 18090 }) {
    const key = path.join(privateRoot, 'media.key'),
        cert = path.join(privateRoot, 'media.crt');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            key,
            '-out',
            cert,
            '-days',
            '1',
            '-subj',
            '/CN=127.0.0.1',
        ],
        { stdio: 'ignore' },
    );
    const certBytes = await readFile(cert),
        keyBytes = await readFile(key);
    const spki = createHash('sha256')
        .update(
            new X509Certificate(certBytes).publicKey.export({
                type: 'spki',
                format: 'der',
            }),
        )
        .digest('base64');
    const requests = [];
    const server = https.createServer(
        { key: keyBytes, cert: certBytes },
        async (request, response) => {
            const url = new URL(request.url, 'https://127.0.0.1:' + port);
            if (
                !['GET', 'HEAD'].includes(request.method) ||
                !/^\/api\/v4\/media\/[a-zA-Z0-9_-]+\/bin\/image$/.test(
                    url.pathname,
                ) ||
                ![...url.searchParams.keys()].every((key) => key === 'cap')
            ) {
                response.writeHead(404);
                response.end();
                return;
            }
            try {
                // No Authorization/Cookie forwarding; the real CMS capability boundary decides access.
                const result = await fetch(cms + url.pathname + url.search, {
                    method: request.method,
                });
                const bytes = Buffer.from(await result.arrayBuffer());
                requests.push({
                    status: result.status,
                    bytes: bytes.length,
                    checksum: createHash('sha256').update(bytes).digest('hex'),
                });
                response.writeHead(result.status, {
                    'content-type':
                        result.headers.get('content-type') ||
                        'application/octet-stream',
                    'cache-control': 'no-store',
                    'access-control-allow-origin': '*',
                });
                response.end(bytes);
            } catch {
                response.writeHead(502);
                response.end();
            }
        },
    );
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return {
        origin: 'https://127.0.0.1:' + port,
        spki,
        requests,
        async close() {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
