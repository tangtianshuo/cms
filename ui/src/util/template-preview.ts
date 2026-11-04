interface PreviewConfig { templateOrigin?: string; legacyOrigin?: string; renderers?: string }
export interface PreviewTarget {
    mode: 'template' | 'legacy' | 'unsupported' | 'config-error';
    origin?: string;
    notice: string;
    templateId?: string;
    templateVersion?: string;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function canonicalOrigin(value?: string): string | undefined {
    try {
        const parsed = new URL(value || '');
        return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value ? parsed.origin : undefined;
    } catch { return undefined; }
}
function identity(value: unknown): { id: string; version: string } | undefined {
    if (!object(value) || value.kind !== 'preset-page' || !object(value.preset)) return;
    const { id, version } = value.preset;
    return typeof id === 'string' && typeof version === 'string' ? { id, version } : undefined;
}

function rendererMap(value?: string): { renderers: Map<string, string>; error?: string } {
    if (!value?.trim()) return { renderers: new Map() };
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { return { renderers: new Map(), error: '预览服务映射不是有效的 JSON。' }; }
    if (!object(parsed)) return { renderers: new Map(), error: '预览服务映射必须是 JSON 对象。' };
    const renderers = new Map<string, string>();
    for (const [key, target] of Object.entries(parsed)) {
        const match = key.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/);
        const origin = typeof target === 'string' ? canonicalOrigin(target) : undefined;
        if (!match || !origin || origin !== target) {
            return { renderers: new Map(), error: `预览服务映射项 ${key} 无效，必须使用精确的 templateId@版本 和规范 HTTP(S) origin。` };
        }
        renderers.set(key, origin);
    }
    return { renderers };
}

function templateTarget(id: string, version: string, origin: string): PreviewTarget {
    return { mode: 'template', origin, templateId: id, templateVersion: version,
        notice: `${id} ${version} · 同版本模板预览。` };
}

export function resolvePreviewTarget(payload: unknown, config: PreviewConfig): PreviewTarget {
    const pages = object(payload) && payload.kind === 'preset-site' && Array.isArray(payload.pages)
        ? payload.pages.map(page => object(page) ? identity(page.content) : undefined) : [identity(payload)];
    const first = pages[0];
    if (!first || pages.some(page => !page || page.id !== first.id || page.version !== first.version)) {
        return { mode: 'unsupported', notice: '预览数据的模板身份不一致，请刷新草稿后重试。' };
    }
    const mapping = rendererMap(config.renderers);
    if (mapping.error) return { mode: 'config-error', notice: mapping.error };
    const mapped = mapping.renderers.get(`${first.id}@${first.version}`);
    if (mapped) return templateTarget(first.id, first.version, mapped);
    if (first.id === 'aeroframe' && first.version === '1.0.3') {
        const configured = canonicalOrigin(config.templateOrigin);
        if (configured) return templateTarget(first.id, first.version, configured);
        return config.templateOrigin
            ? { mode: 'config-error', notice: '旧版 AeroFrame 预览 origin 配置无效，必须使用不含路径的规范 HTTP(S) origin。' }
            : { mode: 'unsupported', notice: 'AeroFrame 1.0.3 尚未配置预览服务。请管理员在 VITE_TEMPLATE_PREVIEW_RENDERERS 中登记该精确版本。' };
    }
    if (['aeroframe', 'atelier', 'market'].includes(first.id) && first.version === '1.0.0') {
        const configured = canonicalOrigin(config.legacyOrigin || 'http://localhost:3000');
        return configured ? { mode: 'legacy', origin: configured, notice: '内置展示预览仅用于内容检查，效果可能与独立发布的网站不同。' }
            : { mode: 'unsupported', notice: '内置内容检查预览服务尚未正确配置，请联系管理员。' };
    }
    return { mode: 'unsupported', notice: `模板 ${first.id}@${first.version} 尚未登记可用的同版本预览服务。请联系管理员为该精确版本配置渲染器 origin。` };
}

export function isPreviewReady(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
    frame: { contentWindow: unknown } | undefined, expectedOrigin?: string,
    expectedTemplate?: { id: string; version: string }): boolean {
    return Boolean(canonicalOrigin(expectedOrigin) && frame?.contentWindow && event.source === frame.contentWindow &&
        event.origin === expectedOrigin && event.data?.type === 'storefront:preview-ready' &&
        (!expectedTemplate || event.data.templateId === expectedTemplate.id && event.data.templateVersion === expectedTemplate.version));
}

export function overlayPagePreview(saved: unknown, pageContent: unknown, options: {
    pageKey: string; entryId: string; language: string; settings: boolean;
}) {
    const expected = identity(pageContent);
    if (!object(saved) || saved.kind !== 'preset-site' || !Array.isArray(saved.pages) ||
        saved.language !== options.language || !expected) throw new Error('无法合并当前语言的站点预览，请先保存并检查站点草稿。');
    const payload = JSON.parse(JSON.stringify(saved)) as Record<string, unknown> & {
        pages: Array<{ path: string; pageKey: string; entryId: string; content: Record<string, unknown> }>;
    };
    const target = payload.pages.find(page => page.pageKey === options.pageKey && (options.settings || page.entryId === options.entryId));
    const targetIdentity = identity(target?.content);
    if (!target || !targetIdentity || targetIdentity.id !== expected.id || targetIdentity.version !== expected.version) {
        throw new Error('此条内容尚未出现在站点草稿中，请先保存内容并启用对应页面。');
    }
    target.content = { ...JSON.parse(JSON.stringify(pageContent)), items: target.content.items || [] };
    return { payload, path: target.path };
}

export function sendRendererPreview(frame: { contentWindow?: { postMessage: (value: unknown, origin: string) => void } | null },
    targetOrigin: string, payload: unknown, path?: string) {
    if (!canonicalOrigin(targetOrigin)) return;
    frame.contentWindow?.postMessage({ type: 'storefront:preview', payload: JSON.parse(JSON.stringify(payload)), ...(path ? { path } : {}) }, targetOrigin);
}
