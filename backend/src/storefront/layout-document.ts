export interface LayoutNode {
    id: string;
    kind: 'section' | 'container' | 'component';
    type: string;
    enabled: boolean;
    props: Record<string, unknown>;
    children: LayoutNode[];
    layout?: { display?: 'flow' | 'grid' | 'flex'; columns?: number; gap?: string; align?: 'start' | 'center' | 'end' | 'stretch'; responsive?: Record<string, Record<string, unknown>> };
}

export interface LayoutDocument { version: 1; mode: 'template' | 'structured'; root: LayoutNode[] }
export interface LayoutContract { sections: Array<{ type: string; singleton: boolean; required: boolean; props: Record<string, unknown> }> }

export function layoutFromSectionConfigs(sectionConfigs: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }>): LayoutDocument {
    return { version: 1, mode: 'template', root: sectionConfigs.map((section, index) => ({
        id: `section-${section.type}-${index + 1}`,
        kind: 'section', type: section.type, enabled: section.enabled, props: structuredClone(section.data), children: [],
    })) };
}

function assertNode(node: LayoutNode, seen: Set<string>, contract?: LayoutContract): void {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id) || node.kind !== 'section' || typeof node.type !== 'string' || !node.type || typeof node.enabled !== 'boolean' || !node.props || typeof node.props !== 'object' || Array.isArray(node.props) || !Array.isArray(node.children) || node.children.length > 0) {
        throw new Error('Invalid template layout node');
    }
    seen.add(node.id);
    if (contract) {
        const section = contract.sections.find((item) => item.type === node.type);
        if (!section) throw new Error(`Unknown layout section: ${node.type}`);
        const props = node.props || {};
        const declared = section.props || {};
        if (Object.keys(declared).length > 0) {
            for (const key of Object.keys(props)) if (!(key in declared)) throw new Error(`Unknown layout prop: ${node.type}.${key}`);
            for (const [key, rawSchema] of Object.entries(declared)) {
                const schema = rawSchema as { control?: string; required?: boolean; options?: unknown[] };
                if (schema.required && node.enabled && !(key in props)) throw new Error(`Required layout prop missing: ${node.type}.${key}`);
                if (!(key in props)) continue;
                const value = props[key];
                const control = schema.control;
                if (control === 'number' && typeof value !== 'number') throw new Error(`Invalid layout prop: ${node.type}.${key}`);
                if (control === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid layout prop: ${node.type}.${key}`);
                if (control === 'text' && typeof value !== 'string') throw new Error(`Invalid layout prop: ${node.type}.${key}`);
                if (control === 'enum' && Array.isArray(schema.options) && !schema.options.includes(value)) throw new Error(`Invalid layout prop: ${node.type}.${key}`);
            }
        }
    }
}

export function validateLayoutDocument(layout: unknown, contract?: LayoutContract): asserts layout is LayoutDocument {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('Invalid layout document');
    const value = layout as LayoutDocument;
    if (value.version !== 1 || value.mode !== 'template' || !Array.isArray(value.root)) throw new Error('Unsupported layout document');
    const seen = new Set<string>();
    for (const node of value.root) assertNode(node, seen, contract);
    const counts = new Map<string, number>();
    for (const node of value.root) counts.set(node.type, (counts.get(node.type) || 0) + 1);
    for (const section of contract?.sections || []) {
        if (section.required && !counts.has(section.type)) throw new Error(`Required layout section missing: ${section.type}`);
        if (section.singleton && (counts.get(section.type) || 0) > 1) throw new Error(`Duplicate layout section: ${section.type}`);
    }
}

export function normalizeLayoutDocument(layout: LayoutDocument, contract?: LayoutContract): LayoutDocument {
    validateLayoutDocument(layout, contract);
    return { version: 1, mode: 'template', root: layout.root.map((node) => ({ ...node, props: structuredClone(node.props), children: [] })) };
}

export function sectionConfigsFromLayout(layout: LayoutDocument, contract?: LayoutContract): Array<{ type: string; enabled: boolean; data: Record<string, unknown> }> {
    validateLayoutDocument(layout, contract);
    return layout.root.map((node) => ({ type: node.type, enabled: node.enabled, data: structuredClone(node.props) }));
}
