import { computed, defineComponent, onMounted, ref, watch, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type { EntryLite } from '@bcms/selfhosted-backend/entry/models/main';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
import { Button } from '@bcms/selfhosted-ui/components/button';

interface PageOptions { allowed: string[]; required: string }
interface PageForm {
    title: string;
    path: string;
    seoTitle: string;
    seoDescription: string;
    sections: string[];
    entryId: string;
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
        const currentPage = computed(() => props.site.pages.find((page) => page.key === selectedKey.value));
        const options = computed(() => props.pageOptions[selectedKey.value]);
        const form = ref<PageForm>({ title: '', path: '', seoTitle: '', seoDescription: '', sections: [], entryId: '' });
        const homeEntries = ref<EntryLite[]>([]);
        const saving = ref(false);
        const error = ref('');

        watch([() => props.site, selectedKey], () => {
            const page = currentPage.value;
            if (!page) return;
            form.value = {
                title: page.title, path: page.path,
                seoTitle: page.seoTitle ?? page.title,
                seoDescription: page.seoDescription ?? '',
                sections: [...(page.sections ?? options.value?.allowed ?? [])],
                entryId: page.entryId ?? '',
            };
            error.value = '';
        }, { immediate: true });

        onMounted(async () => {
            const home = props.site.models.find((model) => model.key === 'home');
            if (!home) return;
            try {
                await sdk.entry.getAllLiteByTemplateId({ templateId: home.templateId });
                homeEntries.value = sdk.store.entryLite.findMany((entry) => entry.templateId === home.templateId);
            } catch {
                homeEntries.value = [];
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
                await sdk.send({
                    url: `/api/v4/presets/pages/${encodeURIComponent(currentPage.value.key)}`,
                    method: 'POST', data: form.value,
                });
                await props.onSaved();
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
            <div class="mt-5 grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
                <div class="border-y border-gray/60 dark:border-gray">
                    {props.site.pages.map((page) => <button type="button"
                        aria-current={selectedKey.value === page.key ? 'page' : undefined}
                        onClick={() => { selectedKey.value = page.key; }}
                        class={`block w-full border-b border-gray/40 px-3 py-3 text-left text-sm last:border-b-0 ${selectedKey.value === page.key ? 'bg-green/10 font-semibold dark:bg-yellow/10' : ''}`}>
                        <span class="block">{page.title}</span>
                        <span class="block truncate text-xs opacity-60">{page.path}</span>
                    </button>)}
                </div>
                {currentPage.value && <div class="grid max-w-3xl gap-4 sm:grid-cols-2">
                    <label class="text-sm">
                        {t('presets.pageTitle')}
                        <input class={inputClass} value={form.value.title} maxlength={120}
                            onInput={(event) => { form.value.title = (event.target as HTMLInputElement).value; }} />
                    </label>
                    <label class="text-sm">
                        {t('presets.pagePath')}
                        <input class={inputClass} value={form.value.path} maxlength={160}
                            disabled={currentPage.value.path === '/' || currentPage.value.path.includes(':')}
                            onInput={(event) => { form.value.path = (event.target as HTMLInputElement).value; }} />
                    </label>
                    <label class="text-sm">
                        {t('presets.seoTitle')}
                        <input class={inputClass} value={form.value.seoTitle} maxlength={120}
                            onInput={(event) => { form.value.seoTitle = (event.target as HTMLInputElement).value; }} />
                    </label>
                    {currentPage.value.key === 'home' && <label class="text-sm">
                        {t('presets.homeEntry')}
                        <select class={inputClass} value={form.value.entryId}
                            onChange={(event) => { form.value.entryId = (event.target as HTMLSelectElement).value; }}>
                            <option value="">{t('presets.noEntry')}</option>
                            {homeEntries.value.map((entry) => <option value={entry._id}>
                                {entry.info[0]?.title || entry._id}
                            </option>)}
                        </select>
                    </label>}
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
