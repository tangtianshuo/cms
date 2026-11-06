import { defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { contentEditorLocation } from '../../components/studio/editor-target';
import { userErrorMessage } from '../../util/user-message';

/** Legacy bookmarks only resolve authorized identity; all writable state lives in ContentWorkspace. */
export const EntryView = defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const router = useRouter();
        const error = ref('');
        const [selectedLanguage] = window.bcms.useLanguage();
        let alive = true;
        let generation = 0;
        onBeforeUnmount(() => {
            alive = false;
            generation++;
        });
        async function resolveBookmark() {
            const token = ++generation;
            const identity = {
                path: route.fullPath,
                templateId: String(route.params.templateId),
                entryId: String(route.params.entryId),
                query: { ...route.query },
                language:
                    typeof route.query.language === 'string'
                        ? route.query.language
                        : selectedLanguage.value,
            };
            let ownerContext = sdk.context;
            const current = () =>
                alive &&
                token === generation &&
                route.fullPath === identity.path &&
                window.bcms.sdk === sdk &&
                (!ownerContext || sdk.context === ownerContext);
            try {
                const context = await sdk.ensureContext();
                if (!current() || sdk.context !== context) return;
                ownerContext = context;
                if (
                    (identity.query.workspaceId &&
                        identity.query.workspaceId !==
                            context.context.workspaceId) ||
                    (identity.query.siteId &&
                        identity.query.siteId !== context.context.siteId)
                )
                    throw new Error('目标不属于当前网站，请先选择对应网站。');
                const template = await sdk.template.get({
                    templateId: identity.templateId,
                    skipCache: true,
                });
                if (!current()) return;
                const creating = identity.entryId === 'create';
                if (!creating) {
                    await sdk.entry.get({
                        templateId: template._id,
                        entryId: identity.entryId,
                        skipCache: true,
                    });
                    if (!current()) return;
                }
                const languages = await sdk.language.getAll();
                if (!current()) return;
                if (!languages.some((item) => item.code === identity.language))
                    throw new Error('当前网站没有此语言内容。');
                const location = contentEditorLocation({
                    intent: creating ? 'create' : 'edit',
                    workspaceId: context.context.workspaceId,
                    siteId: context.context.siteId,
                    templateId: template._id,
                    entryId: creating ? null : identity.entryId,
                    language: identity.language,
                    groupId:
                        typeof identity.query.group === 'string'
                            ? identity.query.group
                            : undefined,
                    pageKey:
                        typeof identity.query.pageKey === 'string'
                            ? identity.query.pageKey
                            : undefined,
                });
                if (typeof identity.query.field === 'string')
                    location.query.field = identity.query.field;
                if (current()) await router.replace(location);
            } catch (cause) {
                if (current()) error.value = userErrorMessage(cause);
            }
        }
        onMounted(resolveBookmark);
        watch(
            () => route.fullPath,
            () => {
                if (route.name === 'EntryView') void resolveBookmark();
                else generation++;
            },
        );
        return () =>
            error.value ? (
                <div role="alert" class="studio-error">
                    {error.value}
                </div>
            ) : (
                <p role="status">正在打开内容工作区…</p>
            );
    },
});
export default EntryView;
