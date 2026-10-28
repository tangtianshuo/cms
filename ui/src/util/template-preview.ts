interface PreviewConfig { templateOrigin?: string; legacyOrigin?: string }
export interface PreviewTarget {
    mode: 'template' | 'legacy' | 'unsupported';
    origin?: string;
    notice: string;
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

export function resolvePreviewTarget(payload: unknown, config: PreviewConfig): PreviewTarget {
    const pages = object(payload) && payload.kind === 'preset-site' && Array.isArray(payload.pages)
        ? payload.pages.map(page => object(page) ? identity(page.content) : undefined) : [identity(payload)];
    const first = pages[0];
    if (!first || pages.some(page => !page || page.id !== first.id || page.version !== first.version)) {
        return { mode: 'unsupported', notice: '预览数据的模板身份不一致，请刷新草稿后重试。' };
    }
    if (first.id === 'aeroframe' && first.version === '1.0.3') {
        const configured = canonicalOrigin(config.templateOrigin);
        return configured ? { mode: 'template', origin: configured, notice: 'AeroFrame 1.0.3 · 同版本模板预览。' }
            : { mode: 'unsupported', notice: '当前模板支持预览，但尚未配置匹配的预览服务。请联系管理员配置 AeroFrame 1.0.3 渲染器。' };
    }
    if (['aeroframe', 'atelier', 'market'].includes(first.id) && first.version === '1.0.0') {
        const configured = canonicalOrigin(config.legacyOrigin || 'http://localhost:3000');
        return configured ? { mode: 'legacy', origin: configured, notice: '内置展示预览仅用于内容检查，效果可能与独立发布的网站不同。' }
            : { mode: 'unsupported', notice: '内置内容检查预览服务尚未正确配置，请联系管理员。' };
    }
    return { mode: 'unsupported', notice: `当前模板 ${first.id}@${first.version} 不支持同版本预览。请在模板管理中显式采用支持预览的 AeroFrame 1.0.3。` };
}

export function isPreviewReady(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
    frame: { contentWindow: unknown } | undefined, expectedOrigin?: string, requireTemplate = false): boolean {
    return Boolean(canonicalOrigin(expectedOrigin) && frame?.contentWindow && event.source === frame.contentWindow &&
        event.origin === expectedOrigin && event.data?.type === 'storefront:preview-ready' &&
        (!requireTemplate || event.data.templateId === 'aeroframe' && event.data.templateVersion === '1.0.3'));
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
