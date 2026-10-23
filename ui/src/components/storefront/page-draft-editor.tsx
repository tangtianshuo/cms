import { computed, defineComponent, onMounted, ref, watch, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type { EntryLite } from '@bcms/selfhosted-backend/entry/models/main';
import type { SiteInstallation, SitePage } from '@bcms/selfhosted-backend/presets/site-model';
import { Button } from '@bcms/selfhosted-ui/components/button';

interface PageOptions { allowed: string[]; required: string }
interface PageForm {
    title: string;
    path: string;
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    entryId: string;
    enabled: boolean;
    navigation: boolean;
}

export const PageDraftEditor = defineComponent({
    props: {
        site: { type: Object as PropType<SiteInstallation>, required: true },
        pageOptions: { type: Object as PropType<Record<string, PageOptions>>, required: true },
        onSaved: { type: Function as PropType<() => Promise<void>>, required: true },
    },
    setup(props) {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const selectedKey = ref(props.site.pages[0]?.key || '');
        const creating = ref(false);
        const blueprintKey = ref('content');
        const blueprints = computed(() => props.site.pages.filter((page) => !page.blueprintKey && page.layout !== 'home'));
        const currentPage = computed(() => props.site.pages.find((page) =>
            page.key === (creating.value ? blueprintKey.value : selectedKey.value)));
        const options = computed(() => props.pageOptions[currentPage.value?.key || '']);
        const form = ref<PageForm>({ title: '', path: '', seoTitle: '', seoDescription: '', sections: [],
            entryId: '', enabled: true, navigation: true });
        const entries = ref<EntryLite[]>([]);
        const bindingEntries = computed(() => {
            const model = props.site.models.find((item) => item.key === currentPage.value?.modelKey);
            return entries.value.filter((entry) => entry.templateId === model?.templateId);
        });
        const saving = ref(false);
        const error = ref('');

        watch([() => props.site, selectedKey, creating, blueprintKey], () => {
            const page = currentPage.value;
            if (!page) return;
            form.value = {
                title: creating.value ? '' : page.title, path: creating.value ? '' : page.path,
                seoTitle: creating.value ? '' : page.seoTitle ?? page.title,
                seoDescription: creating.value ? '' : page.seoDescription ?? '',
                sections: [...(page.sections ?? options.value?.allowed ?? [])],
                entryId: creating.value ? '' : page.entryId ?? '',
                enabled: creating.value ? true : page.enabled ?? true,
                navigation: creating.value ? true : page.navigation ?? !page.path.includes(':'),
            };
            error.value = '';
        }, { immediate: true });

        onMounted(async () => {
            try {
                for (const model of props.site.models) {
                    await sdk.entry.getAllLiteByTemplateId({ templateId: model.templateId });
                }
                entries.value = sdk.store.entryLite.findMany((entry) => props.site.models.some((model) => model.templateId === entry.templateId));
            } catch {
                entries.value = [];
            }
        });

        function toggleSection(section: string, enabled: boolean) {
            const allowed = options.value?.allowed || [];
            form.value.sections = allowed.filter((item) => item === section
                ? enabled : form.value.sections.includes(item));
        }

        async function save() {
            if (!currentPage.value || saving.value) return;
            saving.value = true;
            error.value = '';
            try {
                const result = await sdk.send<SitePage>({
                    url: creating.value ? '/api/v4/presets/pages' : `/api/v4/presets/pages/${encodeURIComponent(currentPage.value.key)}`,
                    method: 'POST', data: creating.value ? { ...form.value, blueprintKey: blueprintKey.value } : form.value,
                });
                await props.onSaved();
                creating.value = false;
                selectedKey.value = result.key;
                window.bcms.notification.success(t('presets.pageSaved'));
            } catch (cause) {
                error.value = (cause as Error).message || t('presets.pageSaveError');
            } finally {
                saving.value = false;
            }
        }

        const inputClass = 'mt-1 w-full border border-gray bg-white px-3 py-2 text-sm text-dark dark:bg-darkGray dark:text-white';
        return () => <section class="mt-12 border-t border-gray/60 pt-8 dark:border-gray">
            <h2 class="text-lg font-semibold">{t('presets.pagesTitle')}</h2>
            <p class="mt-2 text-sm opacity-70">{t('presets.pageDraftHint')}</p>
            <Button class="mt-4" disabled={saving.value} onClick={() => { creating.value = true; }}>{t('presets.addPage')}</Button>
            <div class="mt-5 grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
                <div class="border-y border-gray/60 dark:border-gray">
                    {props.site.pages.map((page) => <button type="button"
                        aria-current={selectedKey.value === page.key ? 'page' : undefined}
                        onClick={() => { creating.value = false; selectedKey.value = page.key; }}
                        class={`block w-full border-b border-gray/40 px-3 py-3 text-left text-sm last:border-b-0 ${selectedKey.value === page.key ? 'bg-green/10 font-semibold dark:bg-yellow/10' : ''}`}>
                        <span class="block">{page.title}</span>
                        <span class="block truncate text-xs opacity-60">{page.path}</span>
                    </button>)}
                </div>
                {currentPage.value && <div class="grid max-w-3xl gap-4 sm:grid-cols-2">
                    {creating.value && <label class="text-sm sm:col-span-2">
                        {t('presets.blueprint')}
                        <select class={inputClass} value={blueprintKey.value}
                            onChange={(event) => { blueprintKey.value = (event.target as HTMLSelectElement).value; }}>
                            {blueprints.value.map((page) => <option value={page.key}>{page.title}</option>)}
                        </select>
                    </label>}
                    <label class="text-sm">
                        {t('presets.pageTitle')}
                        <input class={inputClass} value={form.value.title} maxlength={120}
                            onInput={(event) => { form.value.title = (event.target as HTMLInputElement).value; }} />
                    </label>
                    <label class="text-sm">
                        {t('presets.pagePath')}
                        <input class={inputClass} value={form.value.path} maxlength={160}
                            disabled={!creating.value && (currentPage.value.path === '/' || currentPage.value.path.includes(':'))}
                            onInput={(event) => { form.value.path = (event.target as HTMLInputElement).value; }} />
                    </label>
                    <label class="text-sm">
                        {t('presets.seoTitle')}
                        <input class={inputClass} value={form.value.seoTitle} maxlength={120}
                            onInput={(event) => { form.value.seoTitle = (event.target as HTMLInputElement).value; }} />
                    </label>
                    {(creating.value || currentPage.value.key === 'home' || currentPage.value.blueprintKey) && <label class="text-sm">
                        {t('presets.boundEntry')}
                        <select class={inputClass} value={form.value.entryId}
                            onChange={(event) => { form.value.entryId = (event.target as HTMLSelectElement).value; }}>
                            <option value="">{t('presets.noEntry')}</option>
                            {bindingEntries.value.map((entry) => <option value={entry._id}>
                                {entry.info[0]?.title || entry._id}
                            </option>)}
                        </select>
                    </label>}
                    <div class="flex flex-wrap gap-5 text-sm sm:col-span-2">
                        <label class="flex items-center gap-2">
                            <input type="checkbox" checked={form.value.enabled} disabled={currentPage.value.layout === 'home'}
                                onChange={(event) => { form.value.enabled = (event.target as HTMLInputElement).checked; }} />
                            {t('presets.pageEnabled')}
                        </label>
                        {(creating.value || !currentPage.value.path.includes(':')) && <label class="flex items-center gap-2">
                            <input type="checkbox" checked={form.value.navigation}
                                onChange={(event) => { form.value.navigation = (event.target as HTMLInputElement).checked; }} />
                            {t('presets.inNavigation')}
                        </label>}
                    </div>
                    <label class="text-sm sm:col-span-2">
                        {t('presets.seoDescription')}
                        <textarea class={`${inputClass} min-h-[85px]`} value={form.value.seoDescription} maxlength={320}
                            onInput={(event) => { form.value.seoDescription = (event.target as HTMLTextAreaElement).value; }} />
                    </label>
                    <fieldset class="border-t border-gray/50 pt-4 sm:col-span-2 dark:border-gray">
                        <legend class="text-sm font-medium">{t('presets.pageSections')}</legend>
                        <div class="mt-2 flex flex-wrap gap-x-6 gap-y-3">
                            {(options.value?.allowed || []).map((section) => <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={form.value.sections.includes(section)}
                                    disabled={section === options.value?.required}
                                    onChange={(event) => toggleSection(section, (event.target as HTMLInputElement).checked)} />
                                {t(`presets.sections.${section}`)}
                            </label>)}
                        </div>
                    </fieldset>
                    {error.value && <p role="alert" class="m-0 text-sm text-red sm:col-span-2">{error.value}</p>}
                    <div class="sm:col-span-2">
                        <Button disabled={saving.value} onClick={save}>{saving.value ? t('presets.savingPage') : t('common.save')}</Button>
                    </div>
                </div>}
            </div>
        </section>;
    },
});
