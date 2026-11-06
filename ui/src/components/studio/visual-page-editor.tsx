import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import type { StudioModel } from '../../sdk/handlers/studio';
import type { TemplateEditorContract } from '@bcms/selfhosted-backend/template-contract/model';
import { SectionPropertyFields } from './section-property-fields';
import { sectionPropertyFields } from './section-property-state';
import type { NavigationNode } from './navigation-editor';
import { moveNavigationNode, moveNode, toggleNode, updateNodeProps, type VisualNode } from './visual-editor-state';
import { isPreviewReady, sendRendererPreview } from '../../util/template-preview';

export interface VisualLayoutDocument { version: 1; mode: 'template'; root: VisualNode[] }

export const VisualPageEditor = defineComponent({
    name: 'VisualPageEditor',
    props: {
        modelValue: { type: Object as PropType<VisualLayoutDocument>, required: true },
        navigation: { type: Array as PropType<NavigationNode[]>, default: () => [] },
        previewUrl: { type: String, default: '' },
        previewPayload: { type: Object as PropType<Record<string, unknown>>, default: undefined },
        previewPath: { type: String, default: '' },
        previewNotice: { type: String, default: '' },
        pageKey: { type: String, default: '' },
        pageTitle: { type: String, default: '' },
        pagePath: { type: String, default: '' },
        seoTitle: { type: String, default: '' },
        seoDescription: { type: String, default: '' },
        templateId: { type: String, default: '' },
        templateVersion: { type: String, default: '' },
        sectionLabels: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
        sectionDefinitions: { type: Array as PropType<TemplateEditorContract['sections']>, default: () => [] },
        media: { type: Array as PropType<Media[]>, default: () => [] },
        models: { type: Array as PropType<StudioModel[]>, default: () => [] },
        onUpload: Function as PropType<() => void>,
        selectedNodeId: { type: String, default: '' },
        panel: { type: String as PropType<'content' | 'sections' | 'page'>, default: 'sections' },
        disabled: Boolean,
    },
    emits: ['update:modelValue', 'update:navigation', 'update:seoTitle', 'update:seoDescription', 'select', 'validation', 'update:panel'],
    setup(props, { emit, slots, expose }) {
        const surface = ref<'properties' | 'canvas'>('properties');
        expose({ showProperties: () => { surface.value = 'properties'; } });
        const propertiesPanel = ref<HTMLElement>();
        let editingSelection: { owner: HTMLElement; start?: number; end?: number; direction?: 'forward' | 'backward' | 'none'; range?: Range } | undefined;
        const rememberEditingSelection = (target: EventTarget | null) => {
            if (surface.value !== 'properties' || !(target instanceof HTMLElement)) return;
            const owner = target.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
            if (!owner || !propertiesPanel.value?.contains(owner)) return;
            if (owner instanceof HTMLInputElement || owner instanceof HTMLTextAreaElement) {
                editingSelection = owner.selectionStart === null ? undefined : { owner, start: owner.selectionStart, end: owner.selectionEnd ?? owner.selectionStart, direction: owner.selectionDirection || 'none' };
            } else {
                const selection = window.getSelection();
                const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
                editingSelection = { owner, range: range && owner.contains(range.startContainer) && owner.contains(range.endContainer) ? range.cloneRange() : undefined };
            }
        };
        const showEditingSurface = async (event: MouseEvent) => {
            const tab = event.currentTarget;
            const saved = editingSelection;
            const returning = surface.value === 'canvas';
            surface.value = 'properties';
            await nextTick();
            // Restore only for an explicit return, while that tab still owns focus.
            // Preview renders, validation navigation and alternate field choices never restore it.
            if (!returning || !saved || surface.value !== 'properties' || (document.activeElement !== tab && document.activeElement !== document.body) || !saved.owner.isConnected || !saved.owner.getClientRects().length || saved.owner.matches(':disabled, [contenteditable="false"]')) return;
            saved.owner.focus({ preventScroll: true });
            if ((saved.owner instanceof HTMLInputElement || saved.owner instanceof HTMLTextAreaElement) && saved.start !== undefined) saved.owner.setSelectionRange(saved.start, saved.end ?? saved.start, saved.direction);
            else if (saved.range && saved.owner.contains(saved.range.startContainer) && saved.owner.contains(saved.range.endContainer)) {
                const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(saved.range);
            }
        };
        const localSelectedNodeId = ref(props.selectedNodeId || props.modelValue.root[0]?.id || '');
        const previewFrame = ref<HTMLIFrameElement>();
        const previewReady = ref(false);
        const previewSiteId = () => typeof props.previewPayload?.siteId === 'string' ? props.previewPayload.siteId : '';
        watch([() => props.previewUrl, () => props.templateId, () => props.templateVersion, previewSiteId],
            () => { previewReady.value = false; }, { flush: 'sync' });
        const previewOrigin = () => { try { return new URL(props.previewUrl).origin; } catch { return ''; } };
        const deliverPreview = () => {
            const origin = previewOrigin();
            if (!previewReady.value || !origin || !props.previewPayload || !previewFrame.value) return;
            sendRendererPreview(previewFrame.value, origin, props.previewPayload, props.previewPath);
        };
        watch(() => [props.previewPayload, props.previewPath], () => deliverPreview(), { deep: true });
        const sendSelect = (nodeId: string, nodeType: string) => {
            const origin = previewOrigin();
            if (!previewReady.value || !origin || !previewFrame.value?.contentWindow || !props.pageKey) return;
            previewFrame.value.contentWindow.postMessage({ type: 'studio:select-node', protocolVersion: 1, templateId: props.templateId, templateVersion: props.templateVersion, pageKey: props.pageKey, nodeId, nodeType }, origin);
        };
        const select = (id: string, notifyFrame = true) => {
            localSelectedNodeId.value = id;
            emit('update:panel', 'sections');
            emit('select', id);
            if (notifyFrame) sendSelect(id, String(props.modelValue.root.find(node => node.id === id)?.type || 'section'));
        };
        const onPreviewMessage = (event: MessageEvent) => {
            const origin = previewOrigin();
            const data = event.data;
            const expected = props.templateId && props.templateVersion
                ? { id: props.templateId, version: props.templateVersion }
                : undefined;
            if (isPreviewReady(event, previewFrame.value, origin, expected)) {
                previewReady.value = true;
                deliverPreview();
                return;
            }
            if (!origin || event.origin !== origin || event.source !== previewFrame.value?.contentWindow || !previewReady.value || !data || data.protocolVersion !== 1 || data.type !== 'studio:node-selected' || data.pageKey !== props.pageKey || (props.templateId && data.templateId !== props.templateId) || (props.templateVersion && data.templateVersion !== props.templateVersion) || typeof data.nodeId !== 'string' || typeof data.nodeType !== 'string') return;
            if (!props.modelValue.root.some(node => node.id === data.nodeId && node.type === data.nodeType)) return;
            select(data.nodeId, false);
        };
        onMounted(() => window.addEventListener('message', onPreviewMessage));
        onBeforeUnmount(() => window.removeEventListener('message', onPreviewMessage));
        const update = (root: VisualNode[]) => emit('update:modelValue', { version: 1, mode: 'template', root });
        const selectedNode = () => props.modelValue.root.find(node => node.id === (props.selectedNodeId || localSelectedNodeId.value));
        const move = (id: string, direction: 'before' | 'after') => {
            const index = props.modelValue.root.findIndex(node => node.id === id);
            const target = props.modelValue.root[index + (direction === 'before' ? -1 : 1)];
            if (target) update(moveNode(props.modelValue.root, id, { position: direction, targetId: target.id }));
        };
        const navigationMove = (id: string, direction: 'before' | 'after') => {
            const index = props.navigation.findIndex(node => node.id === id);
            const target = props.navigation[index + (direction === 'before' ? -1 : 1)];
            if (target) emit('update:navigation', moveNavigationNode(props.navigation as any, id, { position: direction, targetId: target.id }));
        };
        const nodeLabel = (node: VisualNode) => {
            const type = typeof node.type === 'string' ? node.type : '';
            return props.sectionLabels[type] || (type ? '不支持的区块类型' : '未配置区块类型');
        };
        return () => <section class={["studio-visual-page-editor", `studio-surface-${surface.value}`]} aria-label="可视化页面编辑器">
            <div class="studio-mobile-surfaces" role="tablist" aria-label="工作区面板"><button type="button" role="tab" aria-selected={surface.value === 'properties'} onClick={showEditingSurface}>编辑内容</button><button type="button" role="tab" aria-selected={surface.value === 'canvas'} onPointerdown={() => rememberEditingSelection(document.activeElement)} onClick={() => { surface.value = 'canvas'; }}>查看画布</button></div>
            <aside class="studio-visual-sidebar studio-visual-sidebar--left">
                <div class="studio-visual-panel-heading"><h3>页面</h3><span>当前页面</span></div>
                <div class="studio-visual-page-tree" aria-label="当前页面"><strong>{props.pageTitle || '未命名页面'}</strong><small>{props.pagePath || '/'}</small></div>
                <div class="studio-visual-panel-heading"><h3>页面区块</h3><span>{props.modelValue.root.length} 个</span></div>
                <ul class="studio-visual-tree">{props.modelValue.root.map(node => <li key={node.id} class={{ selected: node.id === (props.selectedNodeId || localSelectedNodeId.value), disabled: !node.enabled }}><button class="studio-visual-node-button" type="button" aria-pressed={node.id === (props.selectedNodeId || localSelectedNodeId.value)} onClick={() => select(node.id)}><span class="studio-visual-node-type">{nodeLabel(node)}</span><small>{node.enabled ? '显示中' : '已隐藏'}</small></button><span class="studio-visual-row-actions"><button type="button" aria-label={`上移 ${nodeLabel(node)}`} disabled={props.disabled} onClick={() => move(node.id, 'before')}>↑</button><button type="button" aria-label={`下移 ${nodeLabel(node)}`} disabled={props.disabled} onClick={() => move(node.id, 'after')}>↓</button><button type="button" aria-label={`${node.enabled ? '隐藏' : '显示'} ${nodeLabel(node)}`} disabled={props.disabled} onClick={() => update(toggleNode(props.modelValue.root, node.id, !node.enabled))}>{node.enabled ? '隐藏' : '显示'}</button></span></li>)}</ul>
                <div class="studio-visual-panel-heading studio-visual-panel-heading--navigation"><h3>导航</h3><span>{props.navigation.length} 项</span></div><ul class="studio-visual-tree studio-visual-navigation">{props.navigation.map(node => <li key={node.id} class={{ disabled: node.enabled === false }}><span class="studio-visual-navigation-label">{node.label}</span><span class="studio-visual-row-actions"><button type="button" aria-label={`上移 ${node.label}`} disabled={props.disabled} onClick={() => navigationMove(node.id, 'before')}>↑</button><button type="button" aria-label={`下移 ${node.label}`} disabled={props.disabled} onClick={() => navigationMove(node.id, 'after')}>↓</button></span></li>)}</ul>
            </aside>
            <div class="studio-visual-preview" aria-label="草稿预览">{props.previewUrl ? <iframe key={`${props.previewUrl}:${previewSiteId()}`} ref={previewFrame} title="草稿预览" src={props.previewUrl} onLoad={deliverPreview} sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" /> : <div class="studio-visual-preview-placeholder"><strong>草稿预览</strong><p>{props.previewNotice || (props.previewPayload ? '当前网站尚未提供预览。' : '保存后可在这里打开网站预览。')}</p></div>}</div>
            <aside ref={propertiesPanel} class="studio-visual-sidebar studio-visual-sidebar--right" onFocusout={event => rememberEditingSelection(event.target)}>
                <div class="studio-editor-tabs" role="tablist" aria-label="页面编辑">{(['content', 'sections', 'page'] as const).filter(key => key === 'sections' || slots[key]).map(key => <button type="button" role="tab" aria-selected={props.panel === key} onClick={() => emit('update:panel', key)}>{({ content: '页面内容', sections: '区块', page: '页面信息' })[key]}</button>)}</div>
                <div v-show={props.panel === 'content'}>{slots.content?.()}</div>
                <div v-show={props.panel === 'page'}>{slots.page?.()}</div>
                <div v-show={props.panel === 'sections'}>
                <div class="studio-visual-panel-heading"><h3>属性与 SEO</h3>{selectedNode() && <span>{nodeLabel(selectedNode()!)}</span>}</div>
                <div class="studio-visual-properties studio-visual-seo"><label>SEO 标题<input maxlength={120} value={props.seoTitle} disabled={props.disabled} onInput={event => emit('update:seoTitle', (event.target as HTMLInputElement).value)} /></label><label>SEO 描述<textarea maxlength={320} rows={3} value={props.seoDescription} disabled={props.disabled} onInput={event => emit('update:seoDescription', (event.target as HTMLTextAreaElement).value)} /></label></div>
                {slots.sections?.()}
                {!slots.sections && props.modelValue.root.map(node => <div key={node.id} style={{ display: selectedNode()?.id === node.id ? undefined : 'none' }}><SectionPropertyFields nodeId={node.id} fields={sectionPropertyFields(props.sectionDefinitions.find(section => section.type === node.type)?.props || {})} values={node.props || {}} media={props.media} models={props.models} disabled={props.disabled} onUpload={props.onUpload} onValidation={(key, error) => emit('validation', { nodeId: node.id, key, error })} onChange={(key, value) => { if (!props.disabled) update(updateNodeProps(props.modelValue.root, node.id, { ...node.props, [key]: value })); }} /></div>)}
                {!selectedNode() && <p class="studio-help">选择左侧区块编辑属性。</p>}
                </div>
            </aside>
        </section>;
    },
});
