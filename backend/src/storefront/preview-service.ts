export interface PreviewRuntime {
    templateId: string;
    templateVersion: string;
    protocolVersion: 1;
    digest: string;
    url: string;
}

function origin(value: string): URL {
    let parsed: URL;
    try { parsed = new URL(value); }
    catch { throw new Error('Invalid preview service URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('Preview service URL must be a canonical HTTP(S) origin');
    }
    return parsed;
}

function validRuntime(value: unknown, templateId: string, templateVersion: string, service: URL): value is PreviewRuntime {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const runtime = value as Record<string, unknown>;
    if (runtime.templateId !== templateId || runtime.templateVersion !== templateVersion ||
        runtime.protocolVersion !== 1 || typeof runtime.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(runtime.digest) || typeof runtime.url !== 'string') return false;
    try {
        const url = new URL(runtime.url);
        return url.origin === service.origin && url.pathname ===
            `/preview/${templateId}/${templateVersion}/` && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
}

export async function resolvePreviewRuntime(
    serviceUrl: string,
    templateId: string,
    templateVersion: string,
    fetcher: typeof fetch = fetch,
): Promise<PreviewRuntime | null> {
    if (!serviceUrl) return null;
    const service = origin(serviceUrl);
    let response: Response;
    try {
        response = await fetcher(`${service.origin}/api/v1/renderers/${encodeURIComponent(templateId)}/${encodeURIComponent(templateVersion)}`, {
            headers: { accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
        });
    } catch { throw new Error('Preview service unavailable'); }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Preview service unavailable (${response.status})`);
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error('Preview service returned an invalid renderer descriptor'); }
    if (!validRuntime(value, templateId, templateVersion, service)) {
        throw new Error('Preview service returned an invalid renderer descriptor');
    }
    return value;
}
