export interface VisualNode {
    id: string;
    enabled: boolean;
    props?: Record<string, unknown>;
    children: VisualNode[];
    [key: string]: unknown;
}

export interface MoveTarget { position: 'before' | 'after' | 'inside' | 'end'; targetId?: string }

// Layouts also arrive as Vue reactive proxies; traverse their JSON-shaped content
// rather than passing a Proxy to structuredClone. Keep undefined, false and zero.
function clone<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => clone(item)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
    return value;
}
function hasNode(node: VisualNode, id: string): boolean { return node.id === id || node.children.some((child) => hasNode(child, id)); }

function removeNode<T extends VisualNode>(nodes: T[], id: string): { nodes: T[]; removed?: T } {
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.id === id) return { nodes: [...nodes.slice(0, index), ...nodes.slice(index + 1)], removed: node };
        const childResult = removeNode(node.children as T[], id);
        if (childResult.removed) return { nodes: nodes.map((item, itemIndex) => itemIndex === index ? { ...item, children: childResult.nodes } as T : item), removed: childResult.removed };
    }
    return { nodes };
}

function insertRelative<T extends VisualNode>(nodes: T[], targetId: string, node: T, position: 'before' | 'after' | 'inside'): { nodes: T[]; inserted: boolean } {
    for (let index = 0; index < nodes.length; index += 1) {
        const target = nodes[index];
        if (target.id === targetId) {
            if (position === 'before') return { nodes: [...nodes.slice(0, index), node, ...nodes.slice(index)], inserted: true };
            if (position === 'after') return { nodes: [...nodes.slice(0, index + 1), node, ...nodes.slice(index + 1)], inserted: true };
            return { nodes: nodes.map((item, itemIndex) => itemIndex === index ? { ...item, children: [...item.children, node] } as T : item), inserted: true };
        }
        const nested = insertRelative(target.children as T[], targetId, node, position);
        if (nested.inserted) return { nodes: nodes.map((item, itemIndex) => itemIndex === index ? { ...item, children: nested.nodes } as T : item), inserted: true };
    }
    return { nodes, inserted: false };
}

export function moveNode<T extends VisualNode>(root: T[], nodeId: string, target: MoveTarget): T[] {
    const source = clone(root);
    const extracted = removeNode(source, nodeId);
    if (!extracted.removed) throw new Error(`Node not found: ${nodeId}`);
    const node = extracted.removed;
    if (target.position === 'end') return [...extracted.nodes, node];
    if (!target.targetId || target.targetId === nodeId || hasNode(node, target.targetId)) throw new Error('Invalid move target or descendant cycle');
    const inserted = insertRelative(extracted.nodes, target.targetId, node, target.position);
    if (!inserted.inserted) throw new Error(`Move target not found: ${target.targetId}`);
    return inserted.nodes;
}

export function toggleNode<T extends VisualNode>(root: T[], nodeId: string, enabled: boolean): T[] {
    const source = clone(root);
    let changed = false;
    const visit = (nodes: T[]): T[] => nodes.map((node) => {
        if (node.id === nodeId) { changed = true; return { ...node, enabled } as T; }
        return { ...node, children: visit(node.children as T[]) } as T;
    });
    const result = visit(source);
    if (!changed) throw new Error(`Node not found: ${nodeId}`);
    return result;
}

export function updateNodeProps<T extends VisualNode>(root: T[], nodeId: string, props: Record<string, unknown>): T[] {
    const source = clone(root);
    let changed = false;
    const visit = (nodes: T[]): T[] => nodes.map((node) => {
        if (node.id === nodeId) { changed = true; return { ...node, props: { ...(node.props || {}), ...clone(props) } } as T; }
        return { ...node, children: visit(node.children as T[]) } as T;
    });
    const result = visit(source);
    if (!changed) throw new Error(`Node not found: ${nodeId}`);
    return result;
}

export function moveNavigationNode<T extends VisualNode>(root: T[], nodeId: string, target: MoveTarget): T[] {
    return moveNode(root, nodeId, target);
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
    return value;
}

export function dirtyFingerprint(value: unknown): string { return JSON.stringify(canonical(value)); }

export function createVisualHistory<T>(initial: T) {
    let current = clone(initial);
    const past: T[] = [];
    const future: T[] = [];
    return {
        get value(): T { return clone(current); },
        apply(transform: (value: T) => T): T {
            past.push(clone(current));
            current = clone(transform(clone(current)));
            future.length = 0;
            return clone(current);
        },
        undo(): T {
            const previous = past.pop();
            if (previous === undefined) throw new Error('No undo state available');
            future.push(clone(current));
            current = clone(previous);
            return clone(current);
        },
        redo(): T {
            const next = future.pop();
            if (next === undefined) throw new Error('No redo state available');
            past.push(clone(current));
            current = clone(next);
            return clone(current);
        },
    };
}
