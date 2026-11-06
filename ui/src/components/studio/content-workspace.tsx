import {
    computed,
    defineComponent,
    nextTick,
    onBeforeUnmount,
    onMounted,
    provide,
    ref,
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
        const entry = ref<Entry>();
        const entryOriginal = ref('');
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
        const pageEditor = ref<PageDraft>();
        const original = ref('');
        const editorTab = ref<'content' | 'sections' | 'page'>(
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
        const operationId = crypto.randomUUID();
        let internalNavigation: string | undefined;
        const settings = ref<{
            name: string;
            background: string;
            foreground: string;
            accent: string;
            muted: string;
            navigation: NavigationNode[];
            operations: any;
        }>({
            name: '',
            background: '',
            foreground: '',
            accent: '',
            muted: '',
            navigation: [],
            operations: {},
        });
        const settingsOriginal = ref('');
        const entryDirty = computed(
            () =>
                Boolean(entry.value) &&
                JSON.stringify(entry.value) !== entryOriginal.value,
        );
        const pageDirty = computed(
            () =>
                Boolean(pageEditor.value) &&
                JSON.stringify(pageEditor.value) !==
                    (original.value
                        ? JSON.stringify(JSON.parse(original.value).page)
                        : undefined),
        );
        const settingsDirty = computed(
            () => JSON.stringify(settings.value) !== settingsOriginal.value,
        );
        const dirty = computed(
            () =>
                entryDirty.value ||
                pageDirty.value ||
                settingsDirty.value ||
                Object.keys(sectionInputErrors.value).length > 0 ||
                target.intent === 'create',
        );
        const previewPayload = ref<unknown>();
        const previewRuntime = ref<PreviewRuntime | null>(null);
        const previewLoading = ref(false);
        const previewError = ref('');
        let previewSequence = 0;
        function clearPreview() {
            previewSequence++;
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
        async function loadPreview() {
            if (!isCurrent()) return;
            clearPreview();
            const sequence = previewSequence;
            previewLoading.value = true;
            try {
                const payload = await sdk.send({
                    url: '/api/v4/storefront/site-preview',
                    method: 'GET',
                });
                if (!isCurrent()) return;
                const runtime = await loadPreviewRuntime(payload, (url) =>
                    sdk.send({ url, method: 'GET' }),
                );
                if (!isCurrent() || sequence !== previewSequence) return;
                previewRuntime.value = runtime;
                previewPayload.value = payload;
            } catch (cause) {
                if (isCurrent() && sequence === previewSequence)
                    previewError.value = userErrorMessage(cause);
            } finally {
                if (isCurrent() && sequence === previewSequence)
                    previewLoading.value = false;
            }
        }
        function overlayPagePreview(page: PageDraft) {
            if (
                !previewPayload.value ||
                typeof previewPayload.value !== 'object' ||
                !Array.isArray((previewPayload.value as any).pages)
            )
                return;
            const payload = JSON.parse(
                JSON.stringify(previewPayload.value),
            ) as any;
            const previewPage = payload.pages.find(
                (item: any) => item.pageKey === page.key,
            );
            if (!previewPage?.content) return;
            const previewLayout = page.layoutDocument
                ? JSON.parse(JSON.stringify(page.layoutDocument))
                : undefined;
            for (const node of previewLayout?.root || []) {
                const declared =
                    site.value?.editorContract?.sections.find(
                        (section) => section.type === node.type,
                    )?.props || {};
                for (const [key, field] of Object.entries(declared))
                    if (
                        field.control === 'media' &&
                        node.props[key] &&
                        typeof node.props[key] === 'object' &&
                        '_id' in node.props[key]
                    ) {
                        const image = siteImages.value.find(
                            (item) => item._id === node.props[key]._id,
                        );
                        if (!image) {
                            previewError.value = '所选图片不可用于当前网站。';
                            return;
                        }
                        node.props[key] =
                            `${sdk.config.apiOrigin}${sdk.media.toUri({ media: image })}`;
                    }
            }
            // The renderer intentionally gives the page-level layout precedence.
            previewPage.layoutDocument = previewLayout;
            previewPage.content.layoutDocument = previewLayout;
            previewPage.content.sectionConfigs =
                previewLayout?.root.map((node: any) => ({
                    type: node.type,
                    enabled: node.enabled,
                    data: node.props,
                })) || page.sectionConfigs;
            previewPage.content.sections = page.sections;
            previewPage.content.seo = {
                ...(previewPage.content.seo || {}),
                title: page.seoTitle,
                description: page.seoDescription,
            };
            payload.navigation = JSON.parse(
                JSON.stringify(settings.value.navigation),
            );
            previewPayload.value = payload;
        }
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
                if (isCurrent()) error.value = userErrorMessage(cause);
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
            original.value = JSON.stringify({ page: pageEditor.value });
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
        async function saveEntry(form?: HTMLFormElement) {
            const draft = entry.value;
            if (!isCurrent()) return;
            if (
                !draft ||
                !template.value ||
                !canEdit.value ||
                !validator.validate()
            ) {
                error.value = '请检查内容字段后保存。';
                return;
            }
            if (newPage && !form?.checkValidity()) {
                editorTab.value = 'page';
                await nextTick();
                if (!isCurrent()) return;
                form?.reportValidity();
                return;
            }
            await run(async () => {
                if (target.intent === 'create') {
                    if (newPage) {
                        if (!site.value || !pageEditor.value)
                            throw new Error('页面蓝图不可用。');
                        const page = await sdk.studio.createPage({
                            operationId,
                            expectedUpdatedAt: site.value.updatedAt,
                            blueprintKey: newPage,
                            title: pageEditor.value.title,
                            path: pageEditor.value.path,
                            entry: {
                                ...buildEntryCreateBody(draft),
                                groupId: draft.groupId,
                            },
                        });
                        if (!isCurrent()) return;
                        await openSavedTarget(
                            contentEditorLocation({
                                ...target,
                                intent: 'edit',
                                entryId: page.entryId,
                                pageKey: page.key,
                            }),
                        );
                        return;
                    }
                    const saved = await sdk.entry.create({
                        templateId: draft.templateId,
                        data: {
                            ...buildEntryCreateBody(draft),
                            groupId: draft.groupId,
                        },
                    });
                    if (!isCurrent()) return;
                    entryOriginal.value = JSON.stringify(draft);
                    await openSavedTarget(
                        contentEditorLocation({
                            ...target,
                            intent: 'edit',
                            entryId: saved._id,
                        }),
                    );
                } else {
                    const saved = await sdk.entry.update({
                        _id: draft._id,
                        templateId: draft.templateId,
                        expectedUpdatedAt: draft.updatedAt,
                        groupId: draft.groupId,
                        lng: target.language,
                        status: draft.statuses.find(
                            (item) => item.lng === target.language,
                        )?.id,
                        meta: { props: draft.meta[lngIdx.value].props },
                        content: {
                            nodes:
                                buildEntryCreateBody(draft).content.find(
                                    (item) => item.lng === target.language,
                                )?.nodes || [],
                        },
                    });
                    if (!isCurrent()) return;
                    draft.updatedAt = saved.updatedAt;
                    entryOriginal.value = JSON.stringify(draft);
                    notice.value = '内容草稿已保存。发布更新后才会同步到网站。';
                }
            });
        }
        async function savePage(event: Event) {
            event.preventDefault();
            const form = event.currentTarget;
            if (!(form instanceof HTMLFormElement)) return;
            const page = pageEditor.value;
            const installed = site.value;
            if (!isCurrent() || !page || !installed) return;
            const nodes = (page.layoutDocument as any)?.root || [];
            sectionErrors.value = nodes.flatMap((node: any) =>
                node.enabled
                    ? sectionPropertyFields(
                          installed.editorContract?.sections.find(
                              (section) => section.type === node.type,
                          )?.props || {},
                      )
                          .filter(
                              (field) =>
                                  sectionFieldVisible(field, {
                                      ...Object.fromEntries(
                                          sectionPropertyFields(
                                              installed.editorContract?.sections.find(
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
            const bindingChanged =
                page.entryId !== JSON.parse(original.value).page?.entryId;
            if (bindingChanged && entryDirty.value) {
                error.value = '请先保存页面内容，再修改绑定内容。';
                return;
            }
            const settingsDraft = JSON.parse(JSON.stringify(settings.value));
            const settingsChanged = settingsDirty.value;
            await run(async () => {
                await sdk.studio.savePage(page.key, {
                    expectedUpdatedAt: installed.updatedAt,
                    title: page.title,
                    path: page.path,
                    seoTitle: page.seoTitle,
                    seoDescription: page.seoDescription,
                    sections: page.sections,
                    sectionConfigs: page.sectionConfigs,
                    layoutDocument: page.layoutDocument,
                    entryId: page.entryId,
                    enabled: page.enabled !== false,
                    navigation: page.navigation !== false,
                });
                if (!isCurrent()) return;
                if (settingsChanged) {
                    await refresh();
                    if (!isCurrent()) return;
                    if (!state.value.site)
                        throw new Error('网站状态刷新失败，请重试。');
                    await sdk.studio.saveSettings({
                        expectedUpdatedAt: state.value.site.updatedAt,
                        name: settingsDraft.name,
                        theme: {
                            background: settingsDraft.background,
                            foreground: settingsDraft.foreground,
                            accent: settingsDraft.accent,
                            muted: settingsDraft.muted,
                        },
                        navigation: settingsDraft.navigation,
                        operations: settingsDraft.operations,
                    });
                }
                if (!isCurrent()) return;
                const baseline = JSON.parse(original.value);
                baseline.page = JSON.parse(JSON.stringify(page));
                original.value = JSON.stringify(baseline);
                await refresh();
                if (!isCurrent()) return;
                settingsOriginal.value = JSON.stringify(settings.value);
                await loadPreview();
                if (!isCurrent()) return;
                notice.value =
                    '页面设置已保存。内容标签中未保存的修改仍然保留。';
                if (bindingChanged) {
                    const targetModel = state.value.models.find(
                        (model) => model.key === page.modelKey,
                    );
                    const bound =
                        targetModel?.entries.find(
                            (item) => item.id === page.entryId,
                        ) ||
                        (targetModel?.singleEntry
                            ? targetModel.entries[0]
                            : undefined);
                    // Rebind the editor only when no unsaved content can be displaced.
                    entryOriginal.value = JSON.stringify(entry.value);
                    await openSavedTarget(
                        contentEditorLocation({
                            ...target,
                            intent: bound ? 'edit' : 'page',
                            entryId: bound?.id || null,
                            modelKey: targetModel?.key,
                            templateId: targetModel?.templateId || '',
                            pageKey: page.key,
                        }),
                    );
                }
            });
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
                            page.modelKey === target.modelKey &&
                            (page.entryId === target.entryId ||
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
                    pageEditor.value.title = '';
                    pageEditor.value.path = pageEditor.value.path.replace(
                        /:[a-zA-Z0-9_]+/g,
                        'new-page',
                    );
                }
                loading.value = false;
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
        function submitContent(event: Event) {
            if (explicitSubmit(event))
                void saveEntry(event.currentTarget as HTMLFormElement);
        }
        function submitPage(event: Event) {
            if (!explicitSubmit(event)) return;
            if (editorTab.value === 'content' || newPage)
                void saveEntry(event.currentTarget as HTMLFormElement);
            else void savePage(event);
        }
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
            const options = site.value?.pageOptions[page.key];
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
                                填写页面名称、路径和内容。首次保存后可调整区块和导航。
                            </p>
                        )}
                        <span class="studio-badge muted">页面草稿</span>
                    </div>
                    <fieldset disabled={busy.value}>
                        <VisualPageEditor
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
                                error: validationError,
                            }: {
                                nodeId: string;
                                key: string;
                                error: string | null;
                            }) => {
                                const id = `section-${nodeId}-${key}`;
                                if (validationError)
                                    sectionInputErrors.value[id] =
                                        validationError;
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
                                !site.value?.canManage ||
                                Boolean(newPage)
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
                                                      !site.value?.canManage ||
                                                      Boolean(newPage)
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
                                        <NavigationEditor
                                            modelValue={
                                                settings.value.navigation
                                            }
                                            pages={site.value?.pages || []}
                                            disabled={
                                                busy.value ||
                                                !site.value?.canManage ||
                                                Boolean(newPage)
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
                                                    !site.value?.canManage
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
                                                    !site.value?.canManage
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
                                                    !site.value?.canManage ||
                                                    Boolean(newPage)
                                                }
                                                maxlength={120}
                                                v-model={page.seoTitle}
                                            />
                                        </label>
                                        <label>
                                            SEO 描述
                                            <textarea
                                                disabled={
                                                    !site.value?.canManage ||
                                                    Boolean(newPage)
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
                                                        entryDirty.value ||
                                                        !site.value?.canManage
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
                                                    !site.value?.canManage ||
                                                    Boolean(newPage)
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
                                                    !site.value?.canManage ||
                                                    Boolean(newPage)
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
                                (newPage
                                    ? !canEdit.value
                                    : editorTab.value === 'content'
                                      ? !canEdit.value ||
                                        (!entryDirty.value &&
                                            target.intent !== 'create')
                                      : !site.value?.canManage ||
                                        (!pageDirty.value &&
                                            !settingsDirty.value &&
                                            !Object.keys(
                                                sectionInputErrors.value,
                                            ).length))
                            }
                        >
                            保存
                            {editorTab.value === 'content' || newPage
                                ? '草稿'
                                : '页面设置'}
                        </button>
                    </div>
                </header>
                {error.value && (
                    <div role="alert" class="studio-error">
                        <strong>操作未完成</strong>
                        <p>{error.value}</p>
                        <p>本地修改仍保留，请检查权限或冲突后重试。</p>
                    </div>
                )}
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
