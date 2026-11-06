import { defineComponent, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { contentEditorLocation } from '../../components/studio/editor-target';
import { userErrorMessage } from '../../util/user-message';

/** Legacy bookmarks only resolve authorized identity; all writable state lives in ContentWorkspace. */
export const EntryView = defineComponent({
    setup() {
        const route = useRoute(); const router = useRouter(); const error = ref('');
        onMounted(async () => {
            try {
                const sdk = window.bcms.sdk; const context = await sdk.ensureContext();
                if ((route.query.workspaceId && route.query.workspaceId !== context.context.workspaceId) || (route.query.siteId && route.query.siteId !== context.context.siteId)) throw new Error('目标不属于当前网站，请先选择对应网站。');
                const template = await sdk.template.get({ templateId: String(route.params.templateId), skipCache: true });
                const creating = route.params.entryId === 'create';
                if (!creating) await sdk.entry.get({ templateId: template._id, entryId: String(route.params.entryId), skipCache: true });
                const languages = await sdk.language.getAll();
                const [selectedLanguage] = window.bcms.useLanguage();
                const language = typeof route.query.language === 'string' ? route.query.language : selectedLanguage.value;
                if (!languages.some(item => item.code === language)) throw new Error('当前网站没有此语言内容。');
                const location = contentEditorLocation({ intent: creating ? 'create' : 'edit', workspaceId: context.context.workspaceId, siteId: context.context.siteId, templateId: template._id, entryId: creating ? null : String(route.params.entryId), language, groupId: typeof route.query.group === 'string' ? route.query.group : undefined, pageKey: typeof route.query.pageKey === 'string' ? route.query.pageKey : undefined });
                if (typeof route.query.field === 'string') location.query.field = route.query.field;
                await router.replace(location);
            } catch (cause) { error.value = userErrorMessage(cause); }
        });
        return () => error.value ? <div role="alert" class="studio-error">{error.value}</div> : <p role="status">正在打开内容工作区…</p>;
    },
});
export default EntryView;
