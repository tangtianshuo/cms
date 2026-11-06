import {
    computed,
    defineComponent,
    nextTick,
    onBeforeUnmount,
    onMounted,
    provide,
    ref,
    reactive,
    toRef,
    watch,
    type PropType,
} from 'vue';
import {
    isNavigationFailure,
    onBeforeRouteLeave,
    onBeforeRouteUpdate,
    useRoute,
    useRouter,
} from 'vue-router';
import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import type { StudioState } from '../../sdk/handlers/studio';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import { EntryEditor } from '../entry/editor';
import { createEditorSession, sessionDirty, acknowledgeSession } from './editor-session';
import { createDraftPreview, draftValidation } from './draft-preview';
import { saveSession, type SavePart } from './save-session';
import { settingsRequest } from './settings-request';
import type { StudioDraftOverlay } from '@bcms/selfhosted-backend/studio/draft-preview';
import { StructuredField } from './structured-field';
import { structuredValue } from './structured-value';
import { EntryStatusSelect } from '../inputs/select/entry-status';
import { CopyProvenance } from '../workspace/provenance';
import {
    entryGroupOptions,
    type EntryGroupList,
    type EntryGroupOption,
} from '../workspace/entry-group-options';
import { entryNewFromTemplate } from '../../util/entry';
import { buildEntryCreateBody } from '../../util/entry-create';
import { PropValidator } from '../../util/prop-validation';
import { StringUtility } from '@bcms/selfhosted-utils/string-utility';
import { userErrorMessage } from '../../util/user-message';
import { VisualPageEditor } from './visual-page-editor';
import { SectionEditor } from './section-editor';
import { NavigationEditor, type NavigationNode } from './navigation-editor';
import { siteImageOptions } from './media-options';
import { contentMediaSiteKey } from './content-media-context';
import {
    sectionFieldError,
    sectionFieldVisible,
    sectionPropertyFields,
} from './section-property-state';
import { canUseSectionEditor, sectionTypesForEditor } from './page-options';
import {
    loadPreviewRuntime,
    resolvePreviewTarget,
    type PreviewRuntime,
} from '../../util/template-preview';
import { contentEditorLocation, type EditorTarget } from './editor-target';
function entryTitle(entry: { fields: Record<string, unknown> }) {
    return String(
        (entry.fields.title as string[] | undefined)?.[0] || '未命名内容',
    );
}
export const ContentWorkspace = defineComponent({
    name: 'ContentWorkspace',
    props: {
        target: { type: Object as PropType<EditorTarget>, required: true },
    },
    setup(props) {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const router = useRouter();
        const target = Object.freeze({ ...props.target });
        const ownerPath = route.fullPath;
        const initialQuery = { ...route.query };
        let ownerContext = sdk.context;
        const [, setLanguage] = window.bcms.useLanguage();
        const state = ref<StudioState>({ site: null, models: [] });
        const site = computed(() => state.value.site);
        const media = ref<Media[]>([]);
        const siteImages = computed(() =>
            siteImageOptions(media.value, site.value?.id),
        );
        const busy = ref(false);
        const loading = ref(true);
        const error = ref('');
        const notice = ref('');
        const mediaError = ref('');
        const session = reactive(createEditorSession(target, { settings: {} }));
        const entry = toRef(session.draft, 'entry');
        const entryOriginal = toRef(session.baseline, 'content');
        const missingLanguage = ref(false);
        const slugLocked = ref(false);
        const groups = ref<EntryGroupOption[]>([]);
        const validator = new PropValidator();
        window.bcms.entryPropValidator = validator;
        const template = computed(() =>
            sdk.store.template.findById(target.templateId),
        );
        provide(
            contentMediaSiteKey,
            computed(() => {
                const siteId = entry.value?.siteId || template.value?.siteId;
                return siteId
                    ? { _id: siteId, workspaceId: target.workspaceId }
                    : undefined;
            }),
        );
        const activeModel = computed(() =>
            state.value.models.find(
                (model) => model.templateId === target.templateId,
            ),
        );
        const lngIdx = computed(
            () =>
                entry.value?.meta.findIndex(
                    (meta) => meta.lng === target.language,
                ) ?? -1,
        );
        const pendingLocation = ref<ReturnType<typeof contentEditorLocation>>();
        const canEdit = computed(
            () =>
                isCurrent() &&
                !pendingLocation.value &&
                !missingLanguage.value &&
                sdk.context?.context.role !== 'viewer' &&
                Boolean(
                    sdk.context?.context.instanceAdmin ||
                        sdk.context?.context.templatePermissions?.some(
                            (grant) =>
                                grant._id === target.templateId &&
                                grant[
                                    target.intent === 'create' ? 'post' : 'put'
                                ],
                        ),
                ),
        );
        const editor = computed(() =>
            entry.value
                ? { entry: { id: entry.value._id }, modelKey: target.modelKey }
                : undefined,
        );
        // B6/B7 attach structured adapters and unified save sequencing to this sole local Entry draft.
        const sectionInputErrors = ref<Record<string, string>>({});
        const sectionErrors = ref<
            Array<{ id: string; nodeId: string; message: string }>
        >([]);
        const sectionErrorSummary = ref<HTMLElement>();
        const selectedSection = ref('');
        const pageEditor = toRef(session.draft, 'page');
        const original = toRef(session.baseline, 'page');
        const editorTab = ref<'content' | 'sections' | 'page'>(
            initialQuery.section === 'settings' ? 'page' :
            initialQuery.panel === 'page' ||
                initialQuery.panel === 'content' ||
                initialQuery.panel === 'sections'
                ? initialQuery.panel
                : target.pageKey
                  ? 'sections'
                  : target.intent === 'page'
                    ? 'page'
                    : 'content',
        );
        const newPage =
            typeof initialQuery.blueprint === 'string'
                ? initialQuery.blueprint
                : '';
        const operationId = session.operationId;
        let internalNavigation: string | undefined;
        const settings = toRef(session.draft, 'settings');
        const settingsOriginal = toRef(session.baseline, 'settings');
        const entryDirty = computed(() => sessionDirty(session).content);
        const pageDirty = computed(() => sessionDirty(session).page);
        const settingsDirty = computed(() => sessionDirty(session).settings);
        const dirty = computed(() => entryDirty.value || pageDirty.value || settingsDirty.value || Object.keys(sectionInputErrors.value).length > 0);
        const saveFailure = ref<'content' | 'page' | 'settings'>();
        const conflictState = ref(false);
        const unknownSaveResult = ref(false);
        const checkedServer = ref<{ state: StudioState; entry?: Entry }>();
        const previewLocation = ref<ReturnType<typeof draftValidation>>();
        function validationError(cause: unknown) {
            const result = draftValidation(cause);
            previewLocation.value = result;
            return userErrorMessage(result.cause);
        }
        function displayValue(value: unknown): string {
            if (value == null) return '（空）';
            if (typeof value === 'boolean') return value ? '开启' : '关闭';
            if (typeof value !== 'object') return String(value);
            if (Array.isArray(value)) return value.map(displayValue).join(' / ') || '（空）';
            const object = value as Record<string, unknown>;
            if (typeof object.text === 'string') return object.text;
            if (object._id) return media.value.find(item => item._id === object._id)?.name || '已选择的资源';
            return Object.entries(object).filter(([key]) => !['id','type','lng','plainText','templateId'].includes(key)).map(([, item]) => displayValue(item)).join(' / ') || '内容或格式设置';
        }
        const serverChanges = computed(() => {
            const checked = checkedServer.value;
            if (!checked) return [];
            const rows: Array<{ label: string; local: string; server: string }> = [];
            const add = (label: string, local: unknown, server: unknown) => { if (JSON.stringify(local) !== JSON.stringify(server)) rows.push({ label, local: displayValue(local), server: displayValue(server) }); };
            if (saveFailure.value === 'content' && checked.entry && entry.value) {
                const local = entry.value.meta.find(item => item.lng === target.language);
                const remote = checked.entry.meta.find(item => item.lng === target.language);
                for (const prop of local?.props || []) add(template.value?.props.find(item => item.id === prop.id)?.label || '其他内容字段', prop.data, remote?.props.find(item => item.id === prop.id)?.data);
                add('正文（含格式）', entry.value.content.find(item => item.lng === target.language)?.nodes, checked.entry.content.find(item => item.lng === target.language)?.nodes);
                add('内容分组', groups.value.find(item => item._id === entry.value?.groupId)?.name || entry.value.groupId, groups.value.find(item => item._id === checked.entry?.groupId)?.name || checked.entry.groupId);
                add('内容状态', entry.value.statuses.find(item => item.lng === target.language)?.id, checked.entry.statuses.find(item => item.lng === target.language)?.id);
            }
            const remotePage = checked.state.site?.pages.find(item => item.key === pageEditor.value?.key);
            if (pageDirty.value && pageEditor.value && remotePage) {
                for (const [key, label] of Object.entries({ title: '页面名称', path: '页面路径', seoTitle: '搜索标题', seoDescription: '搜索描述', enabled: '显示页面', navigation: '加入导航', layoutDocument: '页面区块（含格式）' })) add(label, pageEditor.value[key as keyof PageDraft], remotePage[key as keyof PageDraft]);
            }
            if (settingsDirty.value && checked.state.site) {
                const localSettings = settingsRequest(checked.state.site.updatedAt, settings.value);
                for (const [key, label] of Object.entries({ name: '网站名称', theme: '网站颜色', navigation: '网站导航', operations: '搜索与联系设置' })) add(label, localSettings[key as keyof typeof localSettings], checked.state.site[key as keyof NonNullable<StudioState['site']>]);
            }
            return rows;
        });
        async function checkServerVersion() {
            await run(async () => {
                const currentState = await sdk.studio.getSite();
                const currentEntry = saveFailure.value === 'content' && session.created && entry.value ? await sdk.entry.get({ templateId: target.templateId, entryId: entry.value._id, skipCache: true }) : undefined;
                if (!isCurrent()) return;
                if (target.siteId && currentState.site?.id !== target.siteId) throw new Error('目标不属于当前网站。');
                checkedServer.value = { state: currentState, entry: currentEntry };
            });
        }
        function keepLocalWithCheckedVersion() {
            const checked = checkedServer.value;
            if (!isCurrent() || busy.value || !checked) return;
            // Explicit user resolution only changes the checked CAS versions, never the local draft/baselines.
            if (saveFailure.value === 'content' && checked.entry && entry.value) entry.value.updatedAt = checked.entry.updatedAt;
            if (site.value && checked.state.site && !(unknownSaveResult.value && newPage && !session.created)) site.value.updatedAt = checked.state.site.updatedAt;
            checkedServer.value = undefined;
            conflictState.value = false;
            unknownSaveResult.value = false;
            error.value = '';
            notice.value = '已采用核对过的服务器版本，本地修改仍待保存。';
        }
        async function locateValidation() {
            const location = previewLocation.value;
            if (!location || !isCurrent()) return;
            if (location.entryId && location.entryId !== entry.value?._id) {
                const model = state.value.models.find(item => item.key === location.modelKey || item.entries.some(value => value.id === location.entryId));
                if (model?.entries.some(item => item.id === location.entryId)) await router.push({ ...contentEditorLocation({ ...target, intent: 'edit', templateId: model.templateId, modelKey: model.key, entryId: location.entryId, pageKey: location.pageKey }), query: { ...contentEditorLocation({ ...target, intent: 'edit', templateId: model.templateId, modelKey: model.key, entryId: location.entryId, pageKey: location.pageKey }).query, field: location.field } });
                return;
            }
            visualEditor.value?.showProperties();
            let id: string | undefined;
            if (location.field?.startsWith('section.')) {
                const [, nodeId, key] = location.field.split('.');
                selectedSection.value = nodeId; editorTab.value = 'sections'; id = `section-${nodeId}-${key || 'body'}`;
            } else {
                editorTab.value = 'content';
                const index = template.value?.props.findIndex(prop => prop.name === location.field || prop.id === location.field) ?? -1;
                id = index >= 0 ? `entry.meta.${lngIdx.value}.props.${index}` : undefined;
            }
            await nextTick();
            const wrapper = id ? document.getElementById(id) || document.getElementById(`${id}.data.0`) : document.getElementById(`entry.content.${lngIdx.value}.nodes`);
            const control = wrapper?.matches('input, textarea, [contenteditable="true"]') ? wrapper as HTMLElement : wrapper?.querySelector<HTMLElement>('input, textarea, [contenteditable="true"], button');
            control?.scrollIntoView({ block: 'center' }); control?.focus();
        }
        const previewStale = ref(false);
        const visualEditor = ref<{ showProperties: () => void }>();
        let composing = false;
        const previewPayload = ref<unknown>();
        const previewRuntime = ref<PreviewRuntime | null>(null);
        const previewLoading = ref(false);
        const previewError = ref('');
        function clearPreview() {
            draftPreview.cancel();
            previewPayload.value = undefined;
            previewRuntime.value = null;
            previewLoading.value = false;
            previewError.value = '';
        }
        const pagePreviewTarget = computed(() =>
            resolvePreviewTarget(
                previewPayload.value,
                {
                    templateOrigin: import.meta.env
                        .VITE_TEMPLATE_PREVIEW_ORIGIN,
                    legacyOrigin: import.meta.env.VITE_STOREFRONT_ORIGIN,
                    renderers: import.meta.env.VITE_TEMPLATE_PREVIEW_RENDERERS,
                },
                previewRuntime.value,
            ),
        );
        const pagePreviewUrl = computed(
            () =>
                pagePreviewTarget.value.url ||
                (pagePreviewTarget.value.origin
                    ? `${pagePreviewTarget.value.origin}/preview`
                    : ''),
        );
        const pagePreviewPath = computed(() => {
            const pages = (previewPayload.value as any)?.pages;
            const key = pageEditor.value?.key;
            const rendered = Array.isArray(pages)
                ? pages.find(
                      (page: any) =>
                          page.pageKey === key &&
                          (!target.entryId || page.entryId === target.entryId),
                  )
                : undefined;
            return rendered?.path || pageEditor.value?.path || '';
        });
        const canUpload = computed(
            () =>
                sdk.context?.context.role !== 'viewer' &&
                Boolean(
                    sdk.context?.context.instanceAdmin ||
                        sdk.context?.context.mediaPermissions?.post,
                ),
        );
        let alive = true;
        let loadGeneration = 0;
        function isCurrent(generation = loadGeneration) {
            return (
                alive &&
                generation === loadGeneration &&
                route.fullPath === ownerPath &&
                window.bcms.sdk === sdk &&
                (!ownerContext || sdk.context === ownerContext)
            );
        }
        function canLeave(destination: { fullPath: string }) {
            if (destination.fullPath === internalNavigation || loading.value)
                return true;
            return (
                !busy.value &&
                (!dirty.value ||
                    window.confirm('有尚未保存的修改。确定放弃这些修改吗？'))
            );
        }
        function beforeUnload(event: BeforeUnloadEvent) {
            if (dirty.value || busy.value) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        onBeforeRouteLeave(canLeave);
        onBeforeRouteUpdate(canLeave);
        onBeforeUnmount(() => {
            alive = false;
            loadGeneration++;
            clearPreview();
            draftPreview.dispose();
            window.removeEventListener('beforeunload', beforeUnload);
        });
        function resetSettings() {
            const current = state.value.site;
            if (current)
                settings.value = {
                    name: current.name,
                    background: current.theme.background,
                    foreground: current.theme.foreground,
                    accent: current.theme.accent,
                    muted: current.theme.muted,
                    navigation: JSON.parse(
                        JSON.stringify(
                            current.navigation ||
                                current.pages
                                    .filter(
                                        (page) =>
                                            page.navigation !== false &&
                                            page.enabled !== false &&
                                            !page.path.includes(':'),
                                    )
                                    .map((page) => ({
                                        id: `page-${page.key}`,
                                        label: page.title,
                                        href: page.path,
                                        children: [],
                                        enabled: true,
                                    })),
                        ),
                    ) as NavigationNode[],
                    operations: JSON.parse(
                        JSON.stringify(
                            current.operations || {
                                seoTitle: current.name,
                                seoDescription: '',
                                contactFormEnabled: false,
                            },
                        ),
                    ),
                };
            settingsOriginal.value = JSON.stringify(settings.value);
        }
        async function loadMedia() {
            if (!isCurrent()) return;
            mediaError.value = '';
            try {
                const loaded = await sdk.media.getAll({ skipCache: true });
                if (isCurrent())
                    media.value = loaded.filter((item) =>
                        ['IMG', 'SVG', 'GIF'].includes(item.type),
                    );
            } catch (cause) {
                if (isCurrent()) mediaError.value = userErrorMessage(cause);
            }
        }
        const previewKey = () => ({ sessionId: session.sessionId, revision: session.revision, workspaceId: target.workspaceId, siteId: target.siteId || '', language: target.language });
        function pageOverlay(page: PageDraft): PageDraft {
            const { key, blueprintKey, title, path, seoTitle, seoDescription, sections, sectionConfigs, layoutDocument, entryId, enabled, navigation } = page;
            return { key, ...(blueprintKey ? { blueprintKey } : {}), title, path, seoTitle, seoDescription, sections, sectionConfigs, layoutDocument, entryId, enabled: enabled !== false, navigation: navigation !== false } as PageDraft;
        }
        function draftOverlay(): StudioDraftOverlay {
            return {
                ...(entry.value && entryDirty.value && target.modelKey ? { entry: { modelKey: target.modelKey, entryId: session.created ? entry.value._id : undefined, operationId, entry: { ...buildEntryCreateBody(entry.value), groupId: entry.value.groupId } } } : {}),
                ...(pageEditor.value && (pageDirty.value || newPage && !session.created) ? { page: pageOverlay(pageEditor.value) } : {}),
                ...(settingsDirty.value && site.value?.canManage ? { settings: settingsRequest(site.value.updatedAt, settings.value) } : {}),
            };
        }
        const draftPreview = createDraftPreview({ key: previewKey, request: (body, signal) => sdk.studio.preview(body, signal),
            accept: async payload => {
                if (!isCurrent()) return;
                const key = previewKey();
                try {
                    const runtime = previewRuntime.value || await loadPreviewRuntime(payload, url => sdk.send({ url, method: 'GET' }));
                    if (!isCurrent() || key.revision !== session.revision) return;
                    previewRuntime.value = runtime; previewPayload.value = payload; previewError.value = ''; previewStale.value = false;
                } catch (cause) { if (isCurrent() && key.revision === session.revision) { previewError.value = validationError(cause); previewStale.value = true; } }
                finally { if (isCurrent() && key.revision === session.revision) previewLoading.value = false; }
            }, fail: cause => { if (isCurrent()) { previewError.value = validationError(cause); previewStale.value = true; previewLoading.value = false; } },
        });
        function requestPreview() {
            if (!isCurrent() || loading.value || !target.siteId || !pageEditor.value) return;
            previewLoading.value = true;
            try { draftPreview.update(draftOverlay(), composing); }
            catch (cause) { previewError.value = validationError(cause); previewStale.value = true; previewLoading.value = false; }
        }
        async function loadPreview() { requestPreview(); }
        function overlayPagePreview(_page: PageDraft) { /* The single deep draft watcher schedules the authorized full-site projection. */ }
        watch(() => session.draft, () => {
            if (loading.value || busy.value || !isCurrent()) return;
            session.revision++; notice.value = ''; requestPreview();
        }, { deep: true, flush: 'sync' });
        function compositionStart() { composing = true; draftPreview.cancel(); }
        function compositionEnd() { composing = false; requestPreview(); }
        async function refresh() {
            const loaded = await sdk.studio.getSite();
            if (!isCurrent()) return;
            state.value = loaded;
            resetSettings();
        }
        async function run(action: () => Promise<void>) {
            if (busy.value || !isCurrent()) return;
            const focused = document.activeElement instanceof HTMLElement && document.activeElement.matches('[contenteditable="true"]') ? document.activeElement : undefined;
            const selection = window.getSelection();
            const range = focused && selection?.rangeCount && focused.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : undefined;
            let newFocusIntent = false;
            const onFocus = (event: FocusEvent) => { if (event.target !== focused && event.target !== document.body) newFocusIntent = true; };
            if (focused) document.addEventListener('focusin', onFocus);
            busy.value = true;
            error.value = '';
            notice.value = '';
            try {
                await action();
            } catch (cause) {
                if (isCurrent()) error.value = validationError(cause);
            } finally {
                if (isCurrent()) {
                    busy.value = false;
                    await nextTick();
                    if (isCurrent() && error.value && focused?.isConnected && !newFocusIntent && (document.activeElement === document.body || document.activeElement === focused)) {
                        focused.focus();
                        if (range && focused.contains(range.startContainer) && focused.contains(range.endContainer)) { const currentSelection = window.getSelection(); currentSelection?.removeAllRanges(); currentSelection?.addRange(range); }
                    }
                }
                if (focused) document.removeEventListener('focusin', onFocus);
            }
        }
        function uploadMedia() {
            if (!isCurrent() || !canUpload.value) return;
            window.bcms.modalService.handlers.mediaCreateFile.open({
                onDone: async () => {
                    await loadMedia();
                },
            });
        }
        function confirmPage(page: PageDraft) {
            pageEditor.value = JSON.parse(JSON.stringify(page));
            if (!site.value) return;
            const index = site.value.pages.findIndex(item => item.key === page.key);
            const cached = JSON.parse(JSON.stringify(page));
            if (index === -1) site.value.pages.push(cached);
            else site.value.pages.splice(index, 1, cached);
        }
        async function selectPage(key: string) {
            const page = site.value?.pages.find((item) => item.key === key);
            if (
                !isCurrent() ||
                !page ||
                (pageDirty.value &&
                    !window.confirm('有尚未保存的页面修改。确定切换页面吗？'))
            )
                return;
            pageEditor.value = JSON.parse(JSON.stringify(page));
            original.value = JSON.stringify(pageEditor.value);
            sectionInputErrors.value = {};
            sectionErrors.value = [];
            selectedSection.value = '';
            await loadPreview();
        }
        async function openSavedTarget(
            location: ReturnType<typeof contentEditorLocation>,
        ) {
            if (!isCurrent()) return;
            const destination = router.resolve(location).fullPath;
            pendingLocation.value = location;
            notice.value = '';
            internalNavigation = destination;
            try {
                const failure = await router.replace(location);
                if (
                    isNavigationFailure(failure) ||
                    router.currentRoute.value.fullPath !== destination
                ) {
                    throw new Error(
                        '内容绑定已保存，但未能打开新的绑定内容。请重新打开绑定内容后继续编辑。',
                    );
                }
                if (isCurrent()) pendingLocation.value = undefined;
            } finally {
                internalNavigation = undefined;
            }
        }
        async function retrySavedTarget() {
            const location = pendingLocation.value;
            if (location) await run(() => openSavedTarget(location));
        }
        async function saveDraft(event: Event) {
            event.preventDefault();
            const form = event.currentTarget;
            if (!(form instanceof HTMLFormElement) || !isCurrent() || busy.value || conflictState.value) return;
            const page = pageEditor.value;
            const installed = site.value;
            if (entryDirty.value && (!entry.value || !template.value || !canEdit.value || !validator.validate())) { error.value = '请检查内容字段后保存。'; editorTab.value = 'content'; return; }
            const nodes = (page?.layoutDocument as any)?.root || [];
            sectionErrors.value = nodes.flatMap((node: any) =>
                node.enabled
                    ? sectionPropertyFields(
                          installed?.editorContract?.sections.find(
                              (section) => section.type === node.type,
                          )?.props || {},
                      )
                          .filter(
                              (field) =>
                                  sectionFieldVisible(field, {
                                      ...Object.fromEntries(
                                          sectionPropertyFields(
                                              installed?.editorContract?.sections.find(
                                                  (section) =>
                                                      section.type ===
                                                      node.type,
                                              )?.props || {},
                                          )
                                              .filter(
                                                  (item) =>
                                                      item.default !==
                                                      undefined,
                                              )
                                              .map((item) => [
                                                  item.key,
                                                  item.default,
                                              ]),
                                      ),
                                      ...node.props,
                                  }),
                          )
                          .flatMap((field) => {
                              const id = `section-${node.id}-${field.key}`;
                              const message =
                                  sectionInputErrors.value[id] ||
                                  sectionFieldError(
                                      field,
                                      node.props[field.key] ?? field.default,
                                  );
                              return message
                                  ? [
                                        {
                                            id,
                                            nodeId: node.id,
                                            message: `${field.label}：${message}`,
                                        },
                                    ]
                                  : [];
                          })
                    : [],
            );
            if (sectionErrors.value.length) {
                await nextTick();
                if (!isCurrent()) return;
                sectionErrorSummary.value?.focus();
                return;
            }
            if (!form.checkValidity()) {
                editorTab.value = 'page';
                await nextTick();
                if (!isCurrent()) return;
                form.reportValidity();
                return;
            }
            const bindingChanged = Boolean(page && original.value && page.entryId !== JSON.parse(original.value).entryId);
            if (bindingChanged && entryDirty.value) { error.value = '请先保存页面内容，再修改绑定内容。'; return; }
            const overlay = JSON.parse(JSON.stringify(draftOverlay())) as StudioDraftOverlay;
            const full = entry.value ? JSON.parse(JSON.stringify(entry.value)) as Entry : undefined;
            const savedPage = page ? JSON.parse(JSON.stringify(page)) as PageDraft : undefined;
            const savedSettings = JSON.parse(JSON.stringify(settings.value));
            const changed = sessionDirty(session);
            await run(async () => {
                saveFailure.value = undefined;
                draftPreview.cancel();
                // Validate the complete fixed snapshot before the first write; later writes carry the remaining overlay.
                if (target.siteId && activeModel.value && savedPage) {
                    try { await sdk.studio.preview({ sessionId: session.sessionId, revision: session.revision, language: target.language, overlay }); }
                    catch (cause) {
                        if (!draftValidation(cause).saveAllowed) throw cause;
                        previewError.value = validationError(cause); previewStale.value = true;
                    }
                }
                const parts: SavePart[] = [];
                if (newPage && !session.created && full && savedPage && installed) {
                    parts.push({ key: 'page', confirms: ['content','page'], run: async context => {
                        const receipt = await sdk.studio.createPage({ operationId, expectedUpdatedAt: context.siteUpdatedAt, blueprintKey: newPage, title: savedPage.title, path: savedPage.path, page: { seoTitle: savedPage.seoTitle, seoDescription: savedPage.seoDescription, sections: savedPage.sections, sectionConfigs: savedPage.sectionConfigs, layoutDocument: savedPage.layoutDocument, enabled: savedPage.enabled !== false, navigation: savedPage.navigation !== false }, entry: { ...buildEntryCreateBody(full), groupId: full.groupId } });
                        if (!isCurrent()) throw new Error('编辑会话已结束。');
                        const { siteUpdatedAt, entryUpdatedAt, ...confirmed } = receipt;
                        entry.value!._id = confirmed.entryId; entry.value!.updatedAt = entryUpdatedAt;
                        confirmPage(confirmed);
                        return { ...context, entryId: confirmed.entryId, entryUpdatedAt, siteUpdatedAt };
                    } });
                } else {
                    if (changed.content && full && canEdit.value) parts.push({ key: 'content', confirms: ['content'], run: async context => {
                        let id: string; let updatedAt: number;
                        if (installed && activeModel.value && target.modelKey) {
                            const receipt = await sdk.studio.saveEntry(target.modelKey, { entryId: session.created ? context.entryId : undefined, expectedUpdatedAt: context.entryUpdatedAt, operationId, language: target.language, entry: { ...buildEntryCreateBody(full), groupId: full.groupId }, overlay: { ...(overlay.page ? { page: overlay.page } : {}), ...(overlay.settings ? { settings: overlay.settings } : {}) } });
                            id = receipt.id; updatedAt = receipt.updatedAt;
                        } else if (!session.created) {
                            const receipt = await sdk.entry.create({ templateId: full.templateId, data: { ...buildEntryCreateBody(full), groupId: full.groupId } }); id = receipt._id; updatedAt = receipt.updatedAt;
                        } else {
                            const receipt = await sdk.entry.update({ _id: full._id, templateId: full.templateId, expectedUpdatedAt: context.entryUpdatedAt, groupId: full.groupId, lng: target.language, status: full.statuses.find(item => item.lng === target.language)?.id, meta: { props: full.meta.find(item => item.lng === target.language)!.props }, content: { nodes: buildEntryCreateBody(full).content.find(item => item.lng === target.language)?.nodes || [] } }); id = receipt._id; updatedAt = receipt.updatedAt;
                        }
                        if (!isCurrent()) throw new Error('编辑会话已结束。');
                        entry.value!._id = id; entry.value!.updatedAt = updatedAt;
                        return { ...context, entryId: id, entryUpdatedAt: updatedAt };
                    } });
                    if (changed.page && savedPage && installed?.canManage) parts.push({ key: 'page', confirms: ['page'], run: async context => {
                        const { key, ...fields } = pageOverlay(savedPage);
                        delete fields.blueprintKey;
                        const receipt = await sdk.studio.savePage(key, { ...fields, expectedUpdatedAt: context.siteUpdatedAt, enabled: savedPage.enabled !== false, navigation: savedPage.navigation !== false, overlay: overlay.settings ? { settings: overlay.settings } : undefined });
                        if (!isCurrent()) throw new Error('编辑会话已结束。');
                        const { siteUpdatedAt, ...confirmed } = receipt;
                        confirmPage(confirmed);
                        return { ...context, siteUpdatedAt };
                    } });
                }
                if (changed.settings && installed?.canManage) parts.push({ key: 'settings', confirms: ['settings'], run: async context => {
                    const receipt = await sdk.studio.saveSettings(settingsRequest(context.siteUpdatedAt, savedSettings));
                    return { ...context, siteUpdatedAt: receipt.updatedAt };
                } });
                // Confirm each part as soon as its receipt arrives, preserving earlier successes on failure.
                const result = await saveSession(parts.map(part => ({ ...part, run: async context => {
                    const receipt = await part.run(context);
                    if (!isCurrent()) throw new Error('编辑会话已结束。');
                    acknowledgeSession(session, part.confirms);
                    if (site.value) site.value.updatedAt = receipt.siteUpdatedAt;
                    return receipt;
                } })), { entryId: full?._id, entryUpdatedAt: full?.updatedAt, siteUpdatedAt: installed?.updatedAt || 0 });
                if (!isCurrent()) return;
                if (result.failed) {
                    saveFailure.value = result.failed.key;
                    const status = (result.failed.error as { status?: number })?.status;
                    unknownSaveResult.value = status === -1 || Boolean(status && status >= 500);
                    conflictState.value = status === 409 || unknownSaveResult.value;
                    checkedServer.value = undefined;
                    const labels = { content: '内容', page: '页面设置', settings: '网站设置' };
                    const confirmed = result.completed.map(key => labels[key]).join('、');
                    error.value = `${confirmed ? `${confirmed}已保存，` : ''}${labels[result.failed.key]}未保存：${validationError(result.failed.error)}`;
                    return;
                }
                notice.value = '草稿已保存。发布更新后才会同步到网站。';
                if ((target.intent === 'create' && session.created) || bindingChanged) {
                    const model = state.value.models.find(model => model.key === savedPage?.modelKey);
                    const bound = bindingChanged ? model?.entries.find(item => item.id === savedPage?.entryId) || (model?.singleEntry && !savedPage?.entryId ? model.entries[0] : undefined) : undefined;
                    await openSavedTarget(contentEditorLocation({ ...target, intent: bindingChanged ? bound ? 'edit' : 'page' : 'edit', entryId: bindingChanged ? bound?.id || null : result.context.entryId || null, modelKey: bindingChanged ? model?.key : target.modelKey, templateId: bindingChanged ? model?.templateId || '' : target.templateId, pageKey: pageEditor.value?.key || target.pageKey }));
                }
            });
            requestPreview();
        }
        onMounted(async () => {
            const generation = ++loadGeneration;
            const current = () => isCurrent(generation);
            window.addEventListener('beforeunload', beforeUnload);
            try {
                const context = await sdk.ensureContext();
                if (!current() || sdk.context !== context) return;
                ownerContext = context;
                if (
                    context.context.workspaceId !== target.workspaceId ||
                    context.context.siteId !== target.siteId
                )
                    throw new Error('目标不属于当前网站。');
                await refresh();
                if (!current()) return;
                await loadMedia();
                if (!current()) return;
                const groupList = await sdk.send<EntryGroupList>({
                    url: '/api/v4/entry-groups/',
                });
                if (!current()) return;
                await sdk.template.getAll();
                if (!current()) return;
                await sdk.widget.getAll();
                if (!current()) return;
                await sdk.group.getAll();
                if (!current()) return;
                await sdk.language.getAll();
                if (!current()) return;
                let draft: Entry | undefined;
                let raw: Entry | undefined;
                if (target.intent !== 'page') {
                    const entryTemplate = template.value;
                    if (!entryTemplate)
                        throw new Error(
                            '目标内容模型不存在，或你没有访问权限。',
                        );
                    raw = target.entryId
                        ? await sdk.entry.get({
                              templateId: target.templateId,
                              entryId: target.entryId,
                              skipCache: true,
                          })
                        : undefined;
                    if (!current()) return;
                    if (raw?.siteId && raw.siteId !== context.context.siteId)
                        throw new Error('目标内容不属于当前网站。');
                    draft = await entryNewFromTemplate(entryTemplate, raw);
                    if (!current()) return;
                    if (!raw)
                        draft.groupId = groupList.items.some(
                            (group) => group._id === target.groupId,
                        )
                            ? target.groupId
                            : groupList.defaultGroupId;
                }
                if (!current()) return;
                setLanguage(target.language);
                groups.value = entryGroupOptions(groupList, '默认分组');
                missingLanguage.value = Boolean(
                    raw &&
                        !raw.meta.some((meta) => meta.lng === target.language),
                );
                entry.value = draft;
                slugLocked.value = Boolean(
                    (
                        draft?.meta.find((meta) => meta.lng === target.language)
                            ?.props[1]?.data as string[]
                    )?.[0],
                );
                entryOriginal.value = JSON.stringify(draft);
                const boundPages =
                    site.value?.pages.filter(
                        (page) =>
                            (target.modelKey === 'site-settings' ? page.layout === 'home' : page.modelKey === target.modelKey) &&
                            (target.modelKey === 'site-settings' || page.entryId === target.entryId ||
                                (!page.entryId &&
                                    activeModel.value?.singleEntry) ||
                                page.path.includes(':')),
                    ) || [];
                const key = newPage || target.pageKey || boundPages[0]?.key;
                if (
                    newPage &&
                    !site.value?.blueprints.some(
                        (blueprint) =>
                            blueprint.key === newPage &&
                            blueprint.modelKey === target.modelKey,
                    )
                )
                    throw new Error('页面蓝图不可用。');
                if (key) await selectPage(key);
                if (!current()) return;
                if (newPage && pageEditor.value) {
                    pageEditor.value.key = 'new-page';
                    pageEditor.value.blueprintKey = newPage;
                    pageEditor.value.title = '';
                    pageEditor.value.path = pageEditor.value.path.replace(
                        /:[a-zA-Z0-9_]+/g,
                        'new-page',
                    );
                }
                loading.value = false;
                requestPreview();
                await nextTick();
                if (!current()) return;
                const field = initialQuery.field;
                if (typeof field === 'string' && entry.value) {
                    editorTab.value = 'content';
                    await nextTick();
                    if (!current()) return;
                    const entryTemplate = template.value;
                    const index =
                        entryTemplate?.props.findIndex(
                            (item) => item.name === field || item.id === field,
                        ) ?? -1;
                    const wrapper =
                        document.getElementById(
                            `entry.meta.${lngIdx.value}.props.${index}.data.0`,
                        ) ||
                        document.getElementById(
                            `entry.meta.${lngIdx.value}.props.${index}`,
                        );
                    const control = wrapper?.matches(
                        'input, textarea, [contenteditable="true"]',
                    )
                        ? wrapper
                        : wrapper?.querySelector<HTMLElement>(
                              'input, textarea, [contenteditable="true"], button',
                          );
                    if (control) {
                        control.id = `studio-field-${field}`;
                        control.scrollIntoView({ block: 'center' });
                        control.focus();
                    }
                }
            } catch (cause) {
                if (current()) error.value = userErrorMessage(cause);
            } finally {
                if (current()) loading.value = false;
            }
        });
        function explicitSubmit(event: Event) {
            event.preventDefault();
            const submitter = (event as SubmitEvent).submitter;
            return !submitter || submitter.getAttribute('type') === 'submit';
        }
        function submitContent(event: Event) { if (explicitSubmit(event)) void saveDraft(event); }
        function submitPage(event: Event) { if (explicitSubmit(event)) void saveDraft(event); }
        const contentPanel = () => (
            <div class="studio-workspace-content">
                {entry.value && lngIdx.value !== -1 ? (
                    <>
                        <label>
                            内容语言
                            <select
                                aria-label="内容语言"
                                value={target.language}
                                disabled={busy.value}
                                onChange={(event) => {
                                    void router.push(
                                        contentEditorLocation({
                                            ...target,
                                            language: (
                                                event.target as HTMLSelectElement
                                            ).value,
                                        }),
                                    );
                                }}
                            >
                                {sdk.store.language.items().map((item) => (
                                    <option value={item.code}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            内容分组
                            <select
                                aria-label="内容分组"
                                value={entry.value.groupId || ''}
                                disabled={busy.value || !canEdit.value}
                                onChange={(event) => {
                                    if (entry.value)
                                        entry.value.groupId = (
                                            event.target as HTMLSelectElement
                                        ).value;
                                }}
                            >
                                {groups.value.map((group) => (
                                    <option value={group._id}>
                                        {group.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div
                            inert={
                                !canEdit.value || busy.value ? true : undefined
                            }
                            aria-disabled={!canEdit.value || busy.value}
                        >
                            <EntryStatusSelect
                                fixed
                                selected={
                                    entry.value.statuses.find(
                                        (item) => item.lng === target.language,
                                    )?.id
                                }
                                onChange={(status) => {
                                    if (!entry.value || !canEdit.value) return;
                                    const current = entry.value.statuses.find(
                                        (item) => item.lng === target.language,
                                    );
                                    if (current) current.id = status._id;
                                    else
                                        entry.value.statuses.push({
                                            lng: target.language,
                                            id: status._id,
                                        });
                                }}
                            />
                        </div>
                        {target.intent !== 'create' && (
                            <a
                                class="studio-text-link"
                                href={`/d/shares?type=Entry&id=${encodeURIComponent(entry.value._id)}`}
                            >
                                共享此内容
                            </a>
                        )}
                        <CopyProvenance value={entry.value.provenance} />
                        {missingLanguage.value && (
                            <p role="status" class="studio-warning">
                                当前内容没有此语言版本。创建翻译后可在这里填写内容。{sdk.context?.context.role !== 'viewer' && (sdk.context?.context.instanceAdmin || sdk.context?.context.templatePermissions?.some(grant => grant._id === target.templateId && grant.put)) && <button type="button" disabled={busy.value} onClick={() => { if (isCurrent() && !busy.value) missingLanguage.value = false; }}>创建此语言版本</button>}
                            </p>
                        )}
                        <fieldset
                            disabled={busy.value || !canEdit.value}
                            inert={
                                busy.value || !canEdit.value ? true : undefined
                            }
                        >
                            <EntryEditor
                                disabled={busy.value || !canEdit.value}
                                v-slots={{ metadata: () => template.value?.props.slice(2).map((prop, index) => {
                                    const value = entry.value?.meta[lngIdx.value]?.props.find(item => item.id === prop.id);
                                    return value ? <StructuredField key={prop.id} prop={prop} value={value} propIndex={index + 2} entryId={entry.value?._id || ""} languageIndex={lngIdx.value} disabled={busy.value || !canEdit.value} validator={validator} onChange={data => {
                                        if (isCurrent() && canEdit.value && !busy.value) value.data = structuredValue(data).data;
                                    }} /> : null;
                                }) }}
                                entry={entry.value}
                                propValidator={validator}
                                onEditTitle={(value) => {
                                    if (!entry.value) return;
                                    (
                                        entry.value.meta[lngIdx.value].props[0]
                                            .data as string[]
                                    )[0] = value;
                                    if (!slugLocked.value)
                                        (
                                            entry.value.meta[lngIdx.value]
                                                .props[1].data as string[]
                                        )[0] = StringUtility.toSlug(value);
                                }}
                                onEditSlug={(value) => {
                                    if (entry.value) {
                                        slugLocked.value = true;
                                        (
                                            entry.value.meta[lngIdx.value]
                                                .props[1].data as string[]
                                        )[0] = value;
                                    }
                                }}
                            />
                        </fieldset>
                    </>
                ) : (
                    <p class="studio-help">此页面尚未绑定可编辑内容。</p>
                )}
            </div>
        );
        const pageForm = () => {
            const page = pageEditor.value;
            if (!page) return null;
            const options = site.value?.pageOptions[newPage || page.key];
            const canBind =
                page.layout === 'home' || Boolean(page.blueprintKey);
            const fallbackAllowed =
                page.layout === 'home'
                    ? ['hero-carousel', 'info-grid', 'faq']
                    : page.layout === 'product-detail'
                      ? [
                            'product-gallery',
                            'product-information',
                            'product-description',
                            'faq',
                        ]
                      : ['info-grid', 'faq'];
            const effectiveOptions = options || {
                allowed: fallbackAllowed,
                required: '',
                requiredSections: [],
                labels: {},
                visual: false,
            };
            const sectionAllowed = sectionTypesForEditor(effectiveOptions);
            const requiredSections =
                effectiveOptions.requiredSections ||
                (effectiveOptions.required ? [effectiveOptions.required] : []);
            const legacyConfig = (name: string) => ({
                type:
                    name === 'hero'
                        ? 'hero-carousel'
                        : ['feature', 'heading', 'grid', 'story'].includes(name)
                          ? 'info-grid'
                          : name === 'gallery'
                            ? 'product-gallery'
                            : name === 'information'
                              ? 'product-information'
                              : name === 'description'
                                ? 'product-description'
                                : name,
                enabled: false,
                data:
                    name === 'hero' || name === 'hero-carousel'
                        ? { slides: [] }
                        : name === 'gallery' || name === 'product-gallery'
                          ? { images: [] }
                          : [
                                  'feature',
                                  'heading',
                                  'grid',
                                  'story',
                                  'info-grid',
                                  'faq',
                              ].includes(name)
                            ? { items: [] }
                            : {},
            });
            const editorConfigs =
                page.sectionConfigs || page.sections.map(legacyConfig);
            const useSectionEditor = canUseSectionEditor(effectiveOptions);
            const visualLayout = page.layoutDocument || {
                version: 1 as const,
                mode: 'template' as const,
                root: editorConfigs.map((section: any, index: number) => ({
                    id: `section-${section.type}-${index + 1}`,
                    kind: 'section' as const,
                    type: section.type,
                    enabled: section.enabled,
                    props: section.data,
                    children: [],
                })),
            };
            return (
                <form
                    id="studio-page-form"
                    inert={pendingLocation.value ? true : undefined}
                    class="studio-card studio-editor"
                    novalidate
                    onSubmit={submitPage}
                >
                    <div
                        v-show={sectionErrors.value.length > 0}
                        ref={sectionErrorSummary}
                        class="studio-section-error-summary"
                        tabindex={-1}
                        role="alert"
                        aria-labelledby="section-errors-title"
                    >
                        <h3 id="section-errors-title">请检查以下内容后保存</h3>
                        <ul>
                            {sectionErrors.value.map((item) => (
                                <li>
                                    <a
                                        href={`#${item.id}`}
                                        onClick={async (event) => {
                                            event.preventDefault();
                                            selectedSection.value = item.nodeId;
                                            editorTab.value = 'sections';
                                            await nextTick();
                                            document
                                                .getElementById(item.id)
                                                ?.focus();
                                        }}
                                    >
                                        {item.message}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div class="studio-card-heading">
                        <h2>页面资料</h2>
                        {newPage && (
                            <p class="studio-help">
                                填写页面名称、路径、内容和区块，首次保存会一起创建。
                            </p>
                        )}
                        <span class="studio-badge muted">页面草稿</span>
                    </div>
                    <fieldset disabled={busy.value}>
                        <VisualPageEditor
                            ref={visualEditor}
                            modelValue={visualLayout as any}
                            pageTitle={page.title}
                            pagePath={page.path}
                            seoTitle={page.seoTitle}
                            seoDescription={page.seoDescription}
                            previewPayload={previewPayload.value as any}
                            previewNotice={
                                previewError.value ||
                                (previewLoading.value
                                    ? '正在加载网站预览…'
                                    : previewPayload.value
                                      ? pagePreviewTarget.value.notice
                                      : '')
                            }
                            previewUrl={pagePreviewUrl.value}
                            previewPath={pagePreviewPath.value}
                            pageKey={page.key}
                            templateId={site.value?.presetId}
                            templateVersion={site.value?.presetVersion}
                            sectionLabels={effectiveOptions.labels}
                            sectionDefinitions={
                                site.value?.editorContract?.sections || []
                            }
                            media={siteImages.value}
                            models={state.value.models}
                            onUpload={canUpload.value ? uploadMedia : undefined}
                            selectedNodeId={selectedSection.value}
                            onSelect={(id: string) => {
                                selectedSection.value = id;
                            }}
                            onValidation={({
                                nodeId,
                                key,
                                error: sectionValidationError,
                            }: {
                                nodeId: string;
                                key: string;
                                error: string | null;
                            }) => {
                                const id = `section-${nodeId}-${key}`;
                                if (sectionValidationError)
                                    sectionInputErrors.value[id] =
                                        sectionValidationError;
                                else delete sectionInputErrors.value[id];
                                sectionErrors.value =
                                    sectionErrors.value.filter(
                                        (item) => item.id !== id,
                                    );
                            }}
                            navigation={
                                settings.value.navigation ||
                                site.value?.navigation ||
                                []
                            }
                            disabled={
                                busy.value ||
                                !site.value?.canManage
                            }
                            onUpdate:modelValue={(value: any) => {
                                page.layoutDocument = value;
                                page.sectionConfigs = value.root.map(
                                    (node: any) => ({
                                        type: node.type,
                                        enabled: node.enabled,
                                        data: node.props,
                                    }),
                                );
                                page.sections = value.root.map(
                                    (node: any) => node.type,
                                );
                                overlayPagePreview(page);
                            }}
                            onUpdate:navigation={(value: NavigationNode[]) => {
                                settings.value.navigation = value;
                                overlayPagePreview(page);
                            }}
                            onUpdate:seoTitle={(value: string) => {
                                page.seoTitle = value;
                                overlayPagePreview(page);
                            }}
                            onUpdate:seoDescription={(value: string) => {
                                page.seoDescription = value;
                                overlayPagePreview(page);
                            }}
                            panel={editorTab.value}
                            onUpdate:panel={(
                                value: 'content' | 'sections' | 'page',
                            ) => {
                                editorTab.value = value;
                            }}
                            v-slots={{
                                content: contentPanel,
                                ...(useSectionEditor
                                    ? {
                                          sections: () => (
                                              <SectionEditor
                                                  modelValue={
                                                      editorConfigs as any
                                                  }
                                                  allowed={
                                                      sectionAllowed as any
                                                  }
                                                  required={
                                                      requiredSections as any
                                                  }
                                                  labels={
                                                      effectiveOptions.labels
                                                  }
                                                  media={siteImages.value}
                                                  onUpload={
                                                      canUpload.value
                                                          ? uploadMedia
                                                          : undefined
                                                  }
                                                  disabled={
                                                      busy.value ||
                                                      !site.value?.canManage
                                                  }
                                                  onUpdate:modelValue={(
                                                      value: any,
                                                  ) => {
                                                      page.sectionConfigs =
                                                          value;
                                                      page.sections = value.map(
                                                          (section: any) =>
                                                              section.type,
                                                      );
                                                      overlayPagePreview(page);
                                                  }}
                                              />
                                          ),
                                      }
                                    : {}),
                                page: () => (
                                    <div class="studio-fields">
                                        <h3>网站资料与外观</h3>
                                        <button type="button" disabled={busy.value} onClick={() => { const model = state.value.models.find(item => item.key === 'site-settings'); const item = model?.entries[0]; if (model && item) void router.push(contentEditorLocation({ ...target, intent: 'edit', templateId: model.templateId, modelKey: model.key, entryId: item.id, pageKey: undefined })); }}>编辑品牌与联系资料 →</button>
                                        <button type="button" disabled={busy.value} onClick={async () => { await nextTick(); document.querySelector<HTMLElement>('.studio-navigation-editor input')?.focus(); }}>编辑网站导航 →</button>
                                        <label>网站名称<input required maxlength={80} disabled={busy.value || !site.value?.canManage} v-model={settings.value.name} /></label>
                                        {(['background','foreground','accent','muted'] as const).map(key => <label>{({ background:'背景颜色',foreground:'文字颜色',accent:'强调颜色',muted:'弱化颜色' })[key]}<input aria-label={`${key} 十六进制颜色`} required pattern="#[a-fA-F0-9]{6}" disabled={busy.value || !site.value?.canManage} v-model={settings.value[key]} /></label>)}
                                        <label>搜索引擎标题<input maxlength={120} disabled={busy.value || !site.value?.canManage} v-model={settings.value.operations.seoTitle} /></label>
                                        <label>搜索引擎描述<textarea maxlength={320} disabled={busy.value || !site.value?.canManage} v-model={settings.value.operations.seoDescription} /></label>
                                        {(['socialImage','favicon'] as const).map(key => <label>{key === 'socialImage' ? '社交分享图片' : '网站图标'}<select aria-label={key === 'socialImage' ? '社交分享图片' : '网站图标'} disabled={busy.value || !site.value?.canManage} value={settings.value.operations[key]?._id || ''} onChange={event => { const id = (event.target as HTMLSelectElement).value; settings.value.operations[key] = id ? { _id:id } : undefined; }}><option value="">未设置</option>{siteImages.value.map(item => <option value={item._id}>{item.name}</option>)}</select></label>)}
                                        <label>统计工具 ID<input disabled={busy.value || !site.value?.canManage} v-model={settings.value.operations.analyticsId} /></label>
                                        <label class="studio-check"><input type="checkbox" disabled={busy.value || !site.value?.canManage || !site.value?.contactDeliveryConfigured} checked={settings.value.operations.contactFormEnabled} onChange={event => { settings.value.operations.contactFormEnabled = (event.target as HTMLInputElement).checked; }} />启用联系表单</label>
                                        <NavigationEditor
                                            modelValue={
                                                settings.value.navigation
                                            }
                                            pages={site.value?.pages || []}
                                            disabled={
                                                busy.value ||
                                                !site.value?.canManage
                                            }
                                            onUpdate:modelValue={(
                                                value: NavigationNode[],
                                            ) => {
                                                settings.value.navigation =
                                                    value;
                                                overlayPagePreview(page);
                                            }}
                                        />
                                        <label>
                                            页面名称
                                            <input
                                                disabled={
                                                    busy.value || !site.value?.canManage
                                                }
                                                required
                                                maxlength={120}
                                                v-model={page.title}
                                            />
                                        </label>
                                        <label>
                                            访问路径
                                            <input
                                                disabled={
                                                    busy.value || !site.value?.canManage
                                                }
                                                required
                                                v-model={page.path}
                                                readonly={
                                                    page.layout === 'home' ||
                                                    (!page.blueprintKey &&
                                                        page.path.includes(':'))
                                                }
                                            />
                                            <span class="studio-help">
                                                {page.layout === 'home'
                                                    ? '首页路径固定为 /。'
                                                    : !page.blueprintKey &&
                                                        page.path.includes(':')
                                                      ? '动态详情页路径由模板固定。'
                                                      : '使用小写字母、数字、连字符组成的唯一路径，例如 /about-us。'}
                                            </span>
                                        </label>
                                        <label>
                                            SEO 标题
                                            <input
                                                disabled={
                                                    !site.value?.canManage
                                                }
                                                maxlength={120}
                                                v-model={page.seoTitle}
                                            />
                                        </label>
                                        <label>
                                            SEO 描述
                                            <textarea
                                                disabled={
                                                    !site.value?.canManage
                                                }
                                                maxlength={320}
                                                rows={3}
                                                v-model={page.seoDescription}
                                            />
                                        </label>
                                        {canBind && !newPage && (
                                            <label>
                                                绑定内容
                                                <select
                                                    disabled={
                                                        busy.value || entryDirty.value ||
                                                        busy.value || !site.value?.canManage
                                                    }
                                                    v-model={page.entryId}
                                                >
                                                    <option value="">
                                                        {page.blueprintKey
                                                            ? '请选择内容'
                                                            : '使用默认主页内容'}
                                                    </option>
                                                    {state.value.models
                                                        .find(
                                                            (model) =>
                                                                model.key ===
                                                                page.modelKey,
                                                        )
                                                        ?.entries.map(
                                                            (item) => (
                                                                <option
                                                                    value={
                                                                        item.id
                                                                    }
                                                                >
                                                                    {entryTitle(
                                                                        item,
                                                                    )}
                                                                </option>
                                                            ),
                                                        )}
                                                </select>
                                                {entryDirty.value && (
                                                    <span class="studio-help">
                                                        保存页面内容后可更换绑定。
                                                    </span>
                                                )}
                                            </label>
                                        )}
                                        <label class="studio-check">
                                            <input
                                                type="checkbox"
                                                disabled={
                                                    page.layout === 'home' ||
                                                    !site.value?.canManage
                                                }
                                                checked={page.enabled !== false}
                                                onChange={(event) => {
                                                    page.enabled = (
                                                        event.target as HTMLInputElement
                                                    ).checked;
                                                }}
                                            />
                                            启用页面
                                        </label>
                                        <label class="studio-check">
                                            <input
                                                disabled={
                                                    !site.value?.canManage
                                                }
                                                type="checkbox"
                                                checked={
                                                    page.navigation !== false
                                                }
                                                onChange={(event) => {
                                                    page.navigation = (
                                                        event.target as HTMLInputElement
                                                    ).checked;
                                                }}
                                            />
                                            加入导航
                                        </label>
                                    </div>
                                ),
                            }}
                        />
                        {!editor.value && (
                            <p class="studio-help">
                                {page.path.includes(':')
                                    ? '此页面按商品或分类自动生成，请到对应内容分类编辑资料。'
                                    : '此页面尚未绑定可编辑内容，可在上方绑定内容后保存。'}
                            </p>
                        )}
                    </fieldset>
                </form>
            );
        };
        return () => (
            <section
                class="cms-studio studio-content-workspace"
                aria-label="内容编辑工作区"
                onCompositionstart={compositionStart}
                onCompositionend={compositionEnd}
            >
                <header class="studio-header">
                    <div>
                        <button
                            type="button"
                            class="studio-back"
                            disabled={busy.value}
                            onClick={() =>
                                router.push({
                                    path: '/d/studio',
                                    query: {
                                        section: 'content',
                                        modelKey: target.modelKey,
                                    },
                                })
                            }
                        >
                            ← 返回网站内容
                        </button>
                        <p class="studio-eyebrow">WEBSITE CONTENT</p>
                        <h1>
                            {target.intent === 'create'
                                ? '新增内容'
                                : pageEditor.value?.title ||
                                  template.value?.label ||
                                  '网站内容'}
                        </h1>
                    </div>
                    <div class="studio-actions">
                        <span class="studio-save-state">
                            {pendingLocation.value
                                ? '绑定已保存，等待打开内容'
                                : busy.value
                                  ? '正在保存…'
                                  : saveFailure.value
                                    ? '部分内容未保存'
                                  : dirty.value
                                    ? '有未保存的修改'
                                    : '草稿已保存'}
                        </span>
                        <button
                            type="submit"
                            class="primary"
                            form={
                                pageEditor.value
                                    ? 'studio-page-form'
                                    : 'studio-entry-form'
                            }
                            disabled={
                                busy.value ||
                                loading.value ||
                                Boolean(pendingLocation.value) ||
                                conflictState.value || !dirty.value || (!canEdit.value && !site.value?.canManage)
                            }
                        >
                            保存草稿
                        </button>
                    </div>
                </header>
                {error.value && (
                    <div role="alert" class="studio-error">
                        <strong>操作未完成</strong>
                        <p>{error.value}</p>{previewLocation.value?.field && <button type="button" onClick={locateValidation}>定位内容</button>}
                        <p>本地修改仍保留，请检查权限或冲突后重试。</p>
                    </div>
                )}
                {previewStale.value && <div role="status" class="studio-warning">{previewPayload.value ? '预览显示上一次有效内容。' : '当前语言预览不可用。'}{previewLocation.value?.missingTranslations?.length ? <><p>以下内容缺少翻译，当前草稿可以保存。补齐后可查看当前语言预览。</p><ul>{previewLocation.value.missingTranslations.map(issue => <li>{state.value.models.find(model => model.key === issue.modelKey)?.label || issue.modelKey}（{issue.language}{issue.pageKey ? ` / ${issue.pageKey}` : ''}）<button type="button" onClick={() => { previewLocation.value = { ...issue, cause: undefined }; void locateValidation(); }}>编辑缺失翻译</button></li>)}</ul></> : previewError.value}<button type="button" onClick={requestPreview}>重试预览</button>{previewLocation.value?.field && <button type="button" onClick={locateValidation}>定位内容</button>}</div>}
                {conflictState.value && <div role="status" class="studio-warning">{unknownSaveResult.value ? '未能确认本次保存结果，请核对服务器内容后再重试。' : '服务器版本已改变，本地修改已保留。'}<button type="button" disabled={busy.value} onClick={checkServerVersion}>核对服务器版本</button><button type="button" onClick={() => { if (window.confirm('重新读取会放弃尚未保存的本地修改。确定继续吗？')) window.location.reload(); }}>放弃修改并重新读取</button></div>}
                {checkedServer.value && <section aria-label="服务器版本核对" class="studio-card"><h2>核对服务器内容</h2><p>以下是本地与服务器的差异。保留本地修改后，再次保存会提交这些本地内容；服务器再次变化时仍会停止保存。</p>{serverChanges.value.length ? <table><thead><tr><th>内容</th><th>本地修改</th><th>服务器内容</th></tr></thead><tbody>{serverChanges.value.map(row => <tr><th>{row.label}</th><td>{row.local}</td><td>{row.server}</td></tr>)}</tbody></table> : <p>服务器当前内容与本地相同。核对后可重试，创建操作会沿用原操作记录。</p>}<button type="button" disabled={busy.value} onClick={keepLocalWithCheckedVersion}>保留本地修改并采用此版本</button></section>}
                {notice.value && (
                    <p role="status" class="studio-success">
                        {notice.value}
                    </p>
                )}
                {pendingLocation.value && (
                    <button
                        type="button"
                        disabled={busy.value}
                        onClick={retrySavedTarget}
                    >
                        重新打开绑定内容
                    </button>
                )}
                {loading.value ? (
                    <p role="status">正在读取内容…</p>
                ) : (
                    <>
                        {pageEditor.value && (
                            <label class="studio-workspace-page-picker">
                                查看页面
                                <select
                                    aria-label="查看页面"
                                    value={pageEditor.value.key}
                                    disabled={busy.value}
                                    onChange={(event) =>
                                        selectPage(
                                            (event.target as HTMLSelectElement)
                                                .value,
                                        )
                                    }
                                >
                                    {site.value?.pages
                                        .filter(
                                            (page) =>
                                                page.key ===
                                                    pageEditor.value?.key ||
                                                (page.modelKey ===
                                                    target.modelKey &&
                                                    (page.entryId ===
                                                        target.entryId ||
                                                        (!page.entryId &&
                                                            activeModel.value
                                                                ?.singleEntry) ||
                                                        page.path.includes(
                                                            ':',
                                                        ))),
                                        )
                                        .map((page) => (
                                            <option value={page.key}>
                                                {page.title}
                                            </option>
                                        ))}
                                </select>
                            </label>
                        )}
                        {pageEditor.value ? (
                            pageForm()
                        ) : (
                            <form
                                id="studio-entry-form"
                                novalidate
                                onSubmit={submitContent}
                            >
                                <VisualPageEditor
                                    class="studio-unbound"
                                    ref={visualEditor}
                                    modelValue={{
                                        version: 1,
                                        mode: 'template',
                                        root: [],
                                    }}
                                    panel="content"
                                    pageTitle={template.value?.label}
                                    previewNotice="此内容尚未关联网站页面"
                                    v-slots={{ content: contentPanel }}
                                />
                            </form>
                        )}
                    </>
                )}
            </section>
        );
    },
});
export default ContentWorkspace;
