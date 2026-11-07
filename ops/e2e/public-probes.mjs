#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const defaultTimeoutMs = 10_000;
const maximumPageBytes = 2 * 1024 * 1024;
const maximumAssetBytes = 4 * 1024 * 1024;
const maximumPaths = 30;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const tlsErrorCodes = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const contentTypes = new Map([
    ['.avif', 'image/avif'],
    ['.css', 'text/css'],
    ['.gif', 'image/gif'],
    ['.htm', 'text/html'],
    ['.html', 'text/html'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.js', 'application/javascript'],
    ['.mjs', 'application/javascript'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp'],
    ['.xml', 'application/xml'],
]);

class ProbeFailure extends Error {
    constructor(code, cause) {
        super(code, cause ? { cause } : undefined);
        this.code = code;
    }
}

function validateOrigin(value) {
    if (typeof value !== 'string') {
        throw new TypeError('origin must be a credential-free HTTPS origin');
    }
    let origin;
    try {
        origin = new URL(value);
    } catch {
        throw new TypeError('origin must be a credential-free HTTPS origin');
    }
    if (
        origin.protocol !== 'https:' ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash
    ) {
        throw new TypeError('origin must be a credential-free HTTPS origin');
    }
    return origin.origin;
}

function validateMarker(value) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 512 ||
        /[\u0000-\u001f\u007f]/u.test(value)
    ) {
        throw new TypeError('marker must be a bounded printable string');
    }
    return value;
}

function validatePaths(origin, values) {
    if (
        !Array.isArray(values) ||
        values.length < 1 ||
        values.length > maximumPaths
    ) {
        throw new TypeError(
            `paths must contain between 1 and ${maximumPaths} entries`,
        );
    }
    const seen = new Set();
    return values.map((value) => {
        if (
            typeof value !== 'string' ||
            value.length > 2_048 ||
            !value.startsWith('/') ||
            value.startsWith('//') ||
            /[\u0000-\u001f\u007f]/u.test(value)
        ) {
            throw new TypeError('paths must contain confined HTTPS paths');
        }
        const target = new URL(value, origin);
        if (target.origin !== origin) {
            throw new TypeError('paths must remain on the configured origin');
        }
        const normalized = `${target.pathname}${target.search}`;
        if (seen.has(normalized)) {
            throw new TypeError('paths must be unique');
        }
        seen.add(normalized);
        return { input: value, target, pathname: target.pathname };
    });
}

function extensionFor(pathname) {
    const final = pathname.slice(pathname.lastIndexOf('/') + 1);
    const dot = final.lastIndexOf('.');
    return dot === -1 ? '' : final.slice(dot).toLowerCase();
}

function expectationFor(pathname) {
    const extension = extensionFor(pathname);
    const expectedContentType = contentTypes.get(extension) ?? 'text/html';
    const kind = expectedContentType.startsWith('image/')
        ? 'image'
        : expectedContentType === 'text/html'
          ? 'page'
          : 'asset';
    return { extension, expectedContentType, kind };
}

function normalizedContentType(value) {
    return typeof value === 'string'
        ? value.toLowerCase().split(';', 1)[0].trim()
        : '';
}

function contentTypeMatches(actual, expected) {
    if (actual === expected) return true;
    if (expected === 'application/javascript') {
        return actual === 'text/javascript';
    }
    if (expected === 'application/xml') {
        return actual === 'text/xml';
    }
    return false;
}

function challengeRedirect(location, body) {
    return /(?:challenge|captcha|cloudflare|cdn-cgi)/i.test(
        `${location ?? ''}\n${body}`,
    );
}

async function readBoundedBody(response, limit) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > limit) {
                await reader.cancel();
                throw new ProbeFailure('body_too_large');
            }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
        if (error instanceof ProbeFailure) throw error;
        throw error;
    }
}

async function requestWithDeadline(fetcher, url, options, timeoutMs, inspect) {
    const controller = new AbortController();
    let response;
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            response?.body?.cancel().catch(() => undefined);
            reject(new ProbeFailure('timeout'));
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            (async () => {
                response = await fetcher(url, {
                    ...options,
                    signal: controller.signal,
                });
                return inspect(response);
            })(),
            deadline,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function classificationForError(error) {
    const code =
        error?.code ?? error?.cause?.code ?? error?.cause?.cause?.code ?? '';
    if (error instanceof ProbeFailure) return error.code;
    if (
        error?.name === 'AbortError' ||
        code === 'ABORT_ERR' ||
        /deadline|timed? out/i.test(String(error?.message ?? error))
    ) {
        return 'timeout';
    }
    if (tlsErrorCodes.has(code) || /certificate|tls|ssl/i.test(code)) {
        return 'tls_untrusted';
    }
    if (
        [
            'ECONNREFUSED',
            'ECONNRESET',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'ENOTFOUND',
            'EAI_AGAIN',
        ].includes(code)
    ) {
        return 'connection_failed';
    }
    return 'request_failed';
}

async function probePath({ fetcher, marker, path, timeoutMs }) {
    const started = performance.now();
    const { kind, expectedContentType } = expectationFor(path.pathname);
    try {
        const observed = await requestWithDeadline(
            fetcher,
            path.target,
            {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    accept:
                        kind === 'image'
                            ? expectedContentType
                            : `${expectedContentType},text/html;q=0.9,*/*;q=0.1`,
                    'cache-control': 'no-cache',
                },
            },
            timeoutMs,
            async (response) => {
                const location = response.headers.get('location');
                const contentType = normalizedContentType(
                    response.headers.get('content-type'),
                );
                const bodyLimit =
                    kind === 'page' ? maximumPageBytes : maximumAssetBytes;
                const body = redirectStatuses.has(response.status)
                    ? ''
                    : await readBoundedBody(response, bodyLimit);
                if (redirectStatuses.has(response.status)) {
                    await response.body?.cancel();
                }
                return {
                    status: response.status,
                    location,
                    contentType,
                    markerPresent: kind === 'page' && body.includes(marker),
                    body,
                };
            },
        );

        let reason = null;
        if (redirectStatuses.has(observed.status)) {
            reason = challengeRedirect(observed.location, observed.body)
                ? 'challenge_redirect'
                : 'unexpected_redirect';
        } else if (
            observed.status === 404 &&
            path.pathname.startsWith('/products/')
        ) {
            reason = 'product_not_found';
        } else if (observed.status !== 200) {
            reason = `http_status_${observed.status}`;
        } else if (
            !contentTypeMatches(observed.contentType, expectedContentType)
        ) {
            reason = 'content_type_mismatch';
        } else if (kind === 'page' && challengeRedirect('', observed.body)) {
            reason = 'challenge_page';
        } else if (kind === 'page' && !observed.markerPresent) {
            reason = 'marker_missing';
        }
        return {
            path: path.input,
            kind,
            status: observed.status,
            markerPresent: observed.markerPresent,
            expectedContentType,
            contentType: observed.contentType,
            redirectedTo: observed.location,
            reason,
            ok: reason === null,
            latencyMs: Math.round(performance.now() - started),
        };
    } catch (error) {
        return {
            path: path.input,
            kind,
            status: 0,
            markerPresent: false,
            expectedContentType,
            contentType: '',
            redirectedTo: null,
            reason: classificationForError(error),
            ok: false,
            latencyMs: Math.round(performance.now() - started),
        };
    }
}

/**
 * Probe configured public HTTPS paths. It returns evidence for every path and
 * never treats HTTP 200 alone as acceptance success.
 */
export async function probePublishedSite({
    origin,
    marker,
    paths,
    fetcher = fetch,
    timeoutMs = defaultTimeoutMs,
}) {
    const normalizedOrigin = validateOrigin(origin);
    const normalizedMarker = validateMarker(marker);
    const normalizedPaths = validatePaths(normalizedOrigin, paths);
    if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 60_000
    ) {
        throw new TypeError('timeoutMs must be an integer from 1 to 60000');
    }
    if (typeof fetcher !== 'function') {
        throw new TypeError('fetcher must be a function');
    }
    const probes = [];
    for (const path of normalizedPaths) {
        probes.push(
            await probePath({
                fetcher,
                marker: normalizedMarker,
                path,
                timeoutMs,
            }),
        );
    }
    return probes;
}

function usage() {
    throw new TypeError(
        'Usage: node ops/e2e/public-probes.mjs --origin HTTPS_ORIGIN --marker MARKER [--path PATH ...] [--timeout-ms N]',
    );
}

async function main(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            origin: { type: 'string' },
            marker: { type: 'string' },
            path: { type: 'string', multiple: true },
            'timeout-ms': { type: 'string' },
        },
        allowPositionals: false,
        strict: true,
    });
    if (!values.origin || !values.marker) usage();
    const timeoutMs = values['timeout-ms']
        ? Number(values['timeout-ms'])
        : defaultTimeoutMs;
    const probes = await probePublishedSite({
        origin: values.origin,
        marker: values.marker,
        paths: values.path?.length ? values.path : ['/'],
        timeoutMs,
    });
    const passed = probes.every((probe) => probe.ok);
    process.stdout.write(
        `${JSON.stringify({ origin: values.origin, passed, probes }, null, 2)}\n`,
    );
    process.exitCode = passed ? 0 : 1;
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
    });
}
