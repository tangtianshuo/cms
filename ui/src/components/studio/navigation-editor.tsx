import { defineComponent, ref } from 'vue';
export interface NavigationNode { id: string; label: string; href?: string; children: NavigationNode[]; enabled: boolean }

export interface NavigationPageOption { key: string; title: string; path: string; enabled?: boolean }

function copy(nodes: NavigationNode[]): NavigationNode[] { return JSON.parse(JSON.stringify(nodes)) as NavigationNode[]; }

export const NavigationEditor = defineComponent({
    name: 'NavigationEditor',
    props: {
        modelValue: { type: Array, required: true },
        pages: { type: Array, required: true },
        disabled: { type: Boolean, default: false },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const pageChoice = ref('');
        const nextId = () => `navigation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nodes = () => props.modelValue as unknown as NavigationNode[];
        const set = (value: NavigationNode[]) => emit('update:modelValue', copy(value));
        const addGroup = (parent?: NavigationNode) => {
            const group: NavigationNode = { id: nextId(), label: '新分组', children: [], enabled: true };
            if (parent) parent.children.push(group); else nodes().push(group);
            set(nodes());
        };
        const addPage = (parent?: NavigationNode) => {
            const page = (props.pages as unknown as NavigationPageOption[]).find(item => item.path === pageChoice.value);
            const hasHref = (items: NavigationNode[]): boolean => items.some(item => item.href === page?.path || hasHref(item.children));
            if (!page || page.path.includes(':') || hasHref(nodes())) return;
            const node: NavigationNode = { id: nextId(), label: page.title, href: page.path, children: [], enabled: true };
            if (parent) parent.children.push(node); else nodes().push(node);
            pageChoice.value = ''; set(nodes());
        };
        const move = (items: NavigationNode[], index: number, delta: number) => {
            const target = index + delta; if (target < 0 || target >= items.length) return;
            [items[index], items[target]] = [items[target], items[index]]; set(nodes());
        };
        const keyMove = (event: KeyboardEvent, items: NavigationNode[], index: number) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault(); move(items, index, event.key === 'ArrowUp' ? -1 : 1);
        };
        const groups = (items: NavigationNode[], exclude: string): NavigationNode[] => items.flatMap(node => node.id === exclude ? [] : [...(!node.href ? [node] : []), ...groups(node.children, exclude)]);
        const relocate = (id: string, parentId: string) => {
            const next = copy(nodes());
            const find = (items: NavigationNode[]): NavigationNode | undefined => items.find(node => node.id === parentId) || items.map(node => find(node.children)).find(Boolean);
            const take = (items: NavigationNode[]): NavigationNode | undefined => {
                const index = items.findIndex(node => node.id === id);
                if (index >= 0) return items.splice(index, 1)[0];
                for (const node of items) { const found = take(node.children); if (found) return found; }
            };
            if (parentId && !groups(next, id).some(node => node.id === parentId)) return;
            const target = parentId ? find(next) : undefined;
            const node = take(next); if (node) (target?.children || next).push(node);
            set(next);
        };
        const renderItems = (items: NavigationNode[], depth = 0, parentId = ''): unknown[] => items.map((node, index) => <li class="studio-navigation-item" style={{ '--nav-depth': String(depth) }} key={node.id}>
            <div class="studio-navigation-row">
                <input aria-label="导航名称" value={node.label} disabled={props.disabled} onInput={(event) => { node.label = (event.target as HTMLInputElement).value; set(nodes()); }} onKeydown={(event) => keyMove(event, items, index)} />
                {node.href && <span class="studio-navigation-path">{node.href}</span>}
                <select aria-label={`所属分组 ${node.label}`} disabled={props.disabled} value={parentId} onChange={event => relocate(node.id, (event.target as HTMLSelectElement).value)}><option value="">顶层导航</option>{groups(nodes(), node.id).map(group => <option value={group.id}>{group.label}</option>)}</select>
                <label class="studio-check"><input type="checkbox" checked={node.enabled} disabled={props.disabled} onChange={(event) => { node.enabled = (event.target as HTMLInputElement).checked; set(nodes()); }} />显示</label>
                <button type="button" aria-label={`上移 ${node.label}`} disabled={props.disabled || index === 0} onClick={() => move(items, index, -1)}>上移</button>
                <button type="button" aria-label={`下移 ${node.label}`} disabled={props.disabled || index === items.length - 1} onClick={() => move(items, index, 1)}>下移</button>
                {!node.href && <button type="button" disabled={props.disabled} onClick={() => addPage(node)}>添加页面</button>}
                {!node.href && <button type="button" disabled={props.disabled} onClick={() => addGroup(node)}>添加分组</button>}
            </div>
            {node.children.length > 0 && <ul>{renderItems(node.children, depth + 1, node.id)}</ul>}
        </li>);
        return () => <section class="studio-navigation-editor" aria-label="网站导航">
            <div class="studio-card-heading"><div><h3>网站导航</h3><p class="studio-help">整理菜单分组、页面顺序和显示状态。</p></div></div>
            <div class="studio-navigation-actions"><button type="button" disabled={props.disabled} onClick={() => addGroup()}>添加分组</button><select aria-label="选择页面" disabled={props.disabled} value={pageChoice.value} onChange={(event) => { pageChoice.value = (event.target as HTMLSelectElement).value; }}><option value="">选择页面</option>{(props.pages as unknown as NavigationPageOption[]).filter(page => page.enabled !== false && !page.path.includes(':')).map(page => <option value={page.path}>{page.title}</option>)}</select><button type="button" disabled={props.disabled || !pageChoice.value} onClick={() => addPage()}>添加页面</button></div>
            {(nodes().length > 0) ? <ul class="studio-navigation-tree">{renderItems(nodes())}</ul> : <p class="studio-help">还没有导航项目。添加分组或页面开始设置。</p>}
        </section>;
    },
});
