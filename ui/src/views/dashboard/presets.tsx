import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChecklistStep } from '@bcms/selfhosted-backend/presets/checklist';
import type { ImportPlan } from '@bcms/selfhosted-backend/presets/import';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
import { Button } from '@bcms/selfhosted-ui/components/button';

interface PresetSummary {
    id: string;
    version: string;
    name: string;
    description: string;
    heroImage: string;
    theme: { background: string; foreground: string; accent: string; muted: string; font: string };
}

type DemoView = 'home' | 'collection' | 'product' | 'page';

export const PresetsView = defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const catalog = ref<PresetSummary[]>([]);
        const selectedId = ref('');
        const site = ref<SiteInstallation | null>(null);
        const checklist = ref<ChecklistStep[]>([]);
        const plan = ref<ImportPlan | null>(null);
        const name = ref('');
        const includeDemo = ref(false);
        const view = ref<DemoView>('home');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        const loading = ref(true);
        const busy = ref(false);
        const error = ref('');
        let refreshTimer: ReturnType<typeof setInterval> | undefined;
        const origin = new URL(import.meta.env.VITE_STOREFRONT_ORIGIN || 'http://localhost:3000').origin;

        const selected = computed(() => catalog.value.find((item) => item.id === selectedId.value));
        const conflicts = computed(() => plan.value?.models.filter((item) => item.action === 'conflict') || []);
        const otherSite = computed(() => !!site.value && site.value.presetId !== selectedId.value);
        const installed = computed(() => site.value?.status === 'ready' && site.value.presetId === selectedId.value);
        const importInProgress = computed(() => site.value?.status === 'importing' &&
            Date.now() - site.value.updatedAt < 120000);
        const canImport = computed(() => !!selected.value && !!plan.value && !busy.value && !installed.value &&
            !importInProgress.value && !otherSite.value && conflicts.value.length === 0 && name.value.trim().length > 0);
        const previewUrl = computed(() => selected.value
            ? `${origin}/presets/${encodeURIComponent(selected.value.id)}?view=${view.value}` : '');

        async function refreshSite() {
            const result = await sdk.send<{ site: SiteInstallation | null; checklist: ChecklistStep[] }>({
                url: '/api/v4/presets/site', method: 'GET',
            });
            site.value = result.site;
            checklist.value = result.checklist;
            if (result.site) name.value = result.site.name;
        }

        async function choosePreset(id: string) {
            selectedId.value = id;
            view.value = 'home';
            plan.value = null;
            error.value = '';
            try {
                const result = await sdk.send<{ plan: ImportPlan; installedSite: SiteInstallation | null }>({
                    url: `/api/v4/presets/plan/${encodeURIComponent(id)}`, method: 'GET',
                });
                if (selectedId.value === id) {
                    plan.value = result.plan;
                    if (result.installedSite) site.value = result.installedSite;
                }
            } catch (cause) {
                error.value = (cause as { message?: string }).message || t('presets.loadError');
            }
        }

        async function importSelected() {
            if (!canImport.value) return;
            busy.value = true;
            error.value = '';
            try {
                const result = await sdk.send<SiteInstallation>({
                    url: '/api/v4/presets/import', method: 'POST',
                    data: { presetId: selectedId.value, siteName: name.value.trim(), includeDemo: includeDemo.value },
                });
                site.value = result;
                await sdk.template.getAll({ skipCache: true });
                await refreshSite();
            } catch (cause) {
                error.value = (cause as { message?: string }).message || t('presets.importError');
                await refreshSite();
            } finally {
                busy.value = false;
            }
        }

        onMounted(async () => {
            refreshTimer = setInterval(() => {
                if (site.value?.status === 'importing') refreshSite().catch(() => undefined);
            }, 3000);
            try {
                const result = await sdk.send<{ items: PresetSummary[] }>({
                    url: '/api/v4/presets/catalog', method: 'GET',
                });
                catalog.value = result.items;
                await refreshSite();
                const first = site.value?.presetId || result.items[0]?.id;
                if (first) await choosePreset(first);
            } catch (cause) {
                error.value = (cause as { message?: string }).message || t('presets.loadError');
            } finally {
                loading.value = false;
            }
        });
        onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); });

        const views: DemoView[] = ['home', 'collection', 'product', 'page'];

        return () => (
            <div class="px-4 pb-16 pt-8 md:px-8">
                <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 class="text-2xl font-semibold text-dark dark:text-white">{t('presets.title')}</h1>
                        <p class="mt-2 max-w-2xl text-sm text-dark/70 dark:text-light/70">{t('presets.subtitle')}</p>
                    </div>
                    {site.value?.status === 'ready' && (
                        <span class="text-sm text-green dark:text-yellow">{t('presets.installed', { name: site.value.name })}</span>
                    )}
                </div>

                {error.value && <div role="alert" class="mb-6 border-l-4 border-red bg-red/10 px-4 py-3 text-sm text-red">{error.value}</div>}
                {loading.value ? <p class="text-sm">{t('common.loading')}</p> : (
                    <>
                        <div class="grid gap-8 xl:grid-cols-[310px_minmax(0,1fr)]">
                            <section aria-label={t('presets.title')} class="min-w-0">
                                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                    {catalog.value.map((item) => (
                                        <button
                                            type="button"
                                            aria-pressed={selectedId.value === item.id}
                                            onClick={() => choosePreset(item.id)}
                                            class={`overflow-hidden rounded-md border bg-white text-left shadow-sm transition-colors dark:bg-darkGray ${selectedId.value === item.id ? 'border-green dark:border-yellow' : 'border-gray/60 dark:border-gray'}`}
                                        >
                                            <img src={item.heroImage} alt="" class="h-36 w-full object-cover" />
                                            <span class="block p-4">
                                                <strong class="block text-base">{item.name}</strong>
                                                <span class="mt-1 block text-xs opacity-70">{item.description}</span>
                                                <span class="mt-3 flex gap-2" aria-label={t('presets.colors')}>
                                                    {[item.theme.background, item.theme.foreground, item.theme.accent].map((color) => (
                                                        <span class="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: color }} />
                                                    ))}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {selected.value && (
                                <section class="min-w-0">
                                    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h2 class="text-xl font-semibold">{selected.value.name}</h2>
                                            <span class="text-xs opacity-60">v{selected.value.version}</span>
                                        </div>
                                        <div class="flex gap-1 rounded-md border border-gray/60 p-1 dark:border-gray" role="group" aria-label={t('presets.viewport')}>
                                            {(['desktop', 'mobile'] as const).map((mode) => (
                                                <button type="button" aria-pressed={viewport.value === mode} onClick={() => { viewport.value = mode; }}
                                                    class={`rounded px-3 py-1.5 text-sm ${viewport.value === mode ? 'bg-dark text-white dark:bg-light dark:text-dark' : ''}`}>
                                                    {t(`presets.${mode}`)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div class="mb-3 flex flex-wrap gap-1 border-b border-gray/60 dark:border-gray" role="tablist">
                                        {views.map((item) => (
                                            <button type="button" role="tab" aria-selected={view.value === item} onClick={() => { view.value = item; }}
                                                class={`border-b-2 px-4 py-2 text-sm ${view.value === item ? 'border-green font-semibold dark:border-yellow' : 'border-transparent opacity-70'}`}>
                                                {t(`presets.views.${item}`)}
                                            </button>
                                        ))}
                                    </div>
                                    <div class="flex h-[620px] justify-center overflow-hidden border border-gray/60 bg-white dark:border-gray" >
                                        <iframe key={previewUrl.value} title={t('presets.previewTitle', { name: selected.value.name })}
                                            src={previewUrl.value} class="h-full border-0 bg-white"
                                            style={{ width: viewport.value === 'mobile' ? '390px' : '100%', maxWidth: '100%' }} />
                                    </div>
                                </section>
                            )}
                        </div>

                        {selected.value && (
                            <section class="mt-12 border-t border-gray/60 pt-8 dark:border-gray">
                                <h2 class="text-lg font-semibold">{t('presets.importTitle')}</h2>
                                <p class="mt-2 text-sm opacity-70">{t('presets.importSummary')}</p>
                                {plan.value && (
                                    <div class="mt-5">
                                        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {plan.value.models.map((item) => (
                                                <div class="flex justify-between gap-3 border-b border-gray/60 py-2 text-sm dark:border-gray">
                                                    <span>{t(`presets.models.${item.key}`)}</span>
                                                    <span class={item.action === 'conflict' ? 'text-red' : 'opacity-60'}>{t(`presets.actions.${item.action}`)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <p class="mt-5 text-sm font-medium">{t('presets.draftPages')}</p>
                                        <div class="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs opacity-70">
                                            {plan.value.pages.map((page) => <span>{page.title} · {page.path}</span>)}
                                        </div>
                                    </div>
                                )}
                                {otherSite.value && <p class="mt-4 text-sm text-red">{t('presets.otherSite')}</p>}
                                {conflicts.value.length > 0 && <p class="mt-4 text-sm text-red">{t('presets.conflict')}</p>}
                                {installed.value ? <p class="mt-5 text-sm text-green dark:text-yellow">{t('presets.alreadyInstalled')}</p> : (
                                    <div class="mt-6 flex flex-wrap items-end gap-5">
                                        <label class="block min-w-[220px] flex-1 text-sm">
                                            <span class="mb-1 block">{t('presets.siteName')}</span>
                                            <input value={name.value} onInput={(event) => { name.value = (event.target as HTMLInputElement).value; }}
                                                maxlength={80} disabled={!!site.value} class="w-full rounded border border-gray bg-white px-3 py-2 text-dark dark:bg-darkGray dark:text-white" />
                                        </label>
                                        <label class="flex items-center gap-2 pb-2 text-sm">
                                            <input type="checkbox" checked={includeDemo.value} disabled={!!site.value}
                                                onChange={(event) => { includeDemo.value = (event.target as HTMLInputElement).checked; }} />
                                            {t('presets.includeDemo')}
                                        </label>
                                        <Button disabled={!canImport.value} onClick={importSelected}>
                                            {busy.value || importInProgress.value ? t('presets.importing') : site.value?.status === 'failed' || site.value?.status === 'importing' ? t('presets.retry') : t('presets.import')}
                                        </Button>
                                    </div>
                                )}
                            </section>
                        )}

                        {site.value && (
                            <section class="mt-12 border-t border-gray/60 pt-8 dark:border-gray">
                                <h2 class="text-lg font-semibold">{t('presets.checklistTitle')}</h2>
                                <p class="mt-2 text-sm opacity-70">{t('presets.checklistSubtitle')}</p>
                                {site.value.status === 'failed' && <p role="alert" class="mt-3 text-sm text-red">{site.value.importError}</p>}
                                <div class="mt-6 divide-y divide-gray/50 border-y border-gray/50 dark:divide-gray dark:border-gray">
                                    {checklist.value.map((step) => (
                                        <div class="flex flex-wrap items-center gap-3 py-4 text-sm">
                                            <span class={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${step.complete ? 'bg-green text-white' : 'border border-gray/70'}`}>{step.complete ? '✓' : '·'}</span>
                                            <span class="min-w-[140px] font-medium">{t(`presets.steps.${step.key}`)}</span>
                                            <span class="opacity-60">{step.available ? t('presets.entryCount', { count: step.count }) : t('presets.later')}</span>
                                            {step.available && step.href && step.key !== 'theme' && (
                                                <a class="ml-auto text-green underline dark:text-yellow" href={step.href}>{t('presets.openEditor')}</a>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        );
    },
});

export default PresetsView;
