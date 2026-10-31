export interface NavigationNode {
    id: string;
    label: string;
    href?: string;
    /** @deprecated Legacy release consumers used `path`; read boundaries normalize it to `href`. */
    path?: string;
    children: NavigationNode[];
    enabled: boolean;
}

export interface NavigationLink {
    label: string;
    path?: string;
    href?: string;
    id?: string;
    children?: unknown[];
    enabled?: boolean;
}

export interface NavigationOptions {
    publishedPaths?: Iterable<string>;
}

function slug(value: string): string {
    const result = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return result || 'item';
}

function internalPath(href: string): string | null {
    if (!href.startsWith('/') || href.startsWith('//')) return null;
    return href.split(/[?#]/, 1)[0] || '/';
}

/**
 * Convert editor and legacy navigation values into the stable release shape.
 * The function is intentionally defensive because old release payloads used
 * `{ label, path }` links while the editor stores `{ href, children }` nodes.
 */
export function normalizeNavigation(value: unknown, options: NavigationOptions = {}): NavigationNode[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Navigation must be a list');
    const published = options.publishedPaths ? new Set(options.publishedPaths) : undefined;
    const links = new Set<string>();
    const hrefs = new Set<string>();
    const ids = new Set<string>();
    const visit = (items: unknown[], parent = ''): NavigationNode[] => items.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid navigation item');
        const raw = item as Record<string, unknown>;
        const label = typeof raw.label === 'string' ? raw.label.trim() : '';
        if (!label || label.length > 120) throw new Error('Navigation labels must be 1 to 120 characters');
        const rawHref = typeof raw.href === 'string' ? raw.href.trim() :
            typeof raw.path === 'string' ? raw.path.trim() : '';
        const href = rawHref || undefined;
        const path = href ? internalPath(href) : null;
        if (path) {
            if (links.has(path)) throw new Error(`Duplicate navigation link: ${path}`);
            if (published && !published.has(path)) throw new Error(`Navigation link has no published page: ${path}`);
            links.add(path);
        }
        if (href && hrefs.has(href)) throw new Error(`Duplicate navigation link: ${href}`);
        if (href) hrefs.add(href);
        const baseId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${parent}${slug(label || href || 'item')}`;
        let id = baseId;
        let suffix = 2;
        while (ids.has(id)) id = `${baseId}-${suffix++}`;
        ids.add(id);
        const children = raw.children === undefined ? [] : raw.children;
        if (!Array.isArray(children)) throw new Error('Navigation children must be a list');
        return { id, label, ...(href ? { href } : {}), children: visit(children, `${id}-`), enabled: raw.enabled !== false };
    });
    return visit(value);
}

export function navigationLinks(nodes: NavigationNode[]): string[] {
    const links: string[] = [];
    const visit = (items: NavigationNode[]) => items.forEach(item => {
        if (item.href) links.push(item.href);
        visit(item.children);
    });
    visit(nodes);
    return links;
}
