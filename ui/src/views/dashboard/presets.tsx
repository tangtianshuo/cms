import { userErrorMessage } from '@bcms/selfhosted-ui/util/user-message';
import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChecklistStep } from '@bcms/selfhosted-backend/presets/checklist';
import type { ImportPlan } from '@bcms/selfhosted-backend/presets/import';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { PageDraftEditor } from '@bcms/selfhosted-ui/components/storefront/page-draft-editor';
import { ReleaseManager } from '@bcms/selfhosted-ui/components/storefront/release-manager';

interface PresetSummary {
    id: string;
    version: string;
    name: string;
    description: string;
    heroImage: string;
    sourceCommit?: string;
    manifestChecksum?: string;
    theme: { background: string; foreground: string; accent: string; muted: string; font: string };
}

const presetKey = (item: PresetSummary) => `${item.id}@${item.version}:${item.sourceCommit || 'builtin'}`;

type DemoView = 'home' | 'collection' | 'product' | 'page';

export const PresetsView = defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const [, setLanguage] = window.bcms.useLanguage();
        const catalog = ref<PresetSummary[]>([]);
        const selectedKey = ref('');
        const site = ref<SiteInstallation | null>(null);
        const pageOptions = ref<Record<string, { allowed: string[]; required: string }>>({});
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
        const origin = import.meta.env.VITE_STOREFRONT_ORIGIN ? new URL(import.meta.env.VITE_STOREFRONT_ORIGIN).origin : '';

        const selected = computed(() => catalog.value.find((item) => presetKey(item) === selectedKey.value));
        const conflicts = computed(() => plan.value?.models.filter((item) => item.action === 'conflict') || []);
        const otherSite = computed(() => !!site.value?.presetId && site.value.presetId !== selected.value?.id);
        const sameTemplate = computed(() => site.value?.status === 'ready' && site.value.presetId === selected.value?.id);
        const installed = computed(() => sameTemplate.value && site.value?.presetVersion === selected.value?.version &&
            (!!site.value?.publishedTemplateRecord === !!selected.value?.sourceCommit));
        const canAdopt = computed(() => sameTemplate.value && !installed.value && !!selected.value?.sourceCommit && !!plan.value &&
            !busy.value && !!sdk.context?.context.admin && conflicts.value.length === 0);
        const importInProgress = computed(() => site.value?.status === 'importing' &&
            Date.now() - site.value.updatedAt < 120000);
        const importOptionsLocked = computed(() => busy.value || (!!site.value && site.value.status !== 'empty'));
        const canImport = computed(() => !!sdk.context?.context.admin && !!sdk.context?.context.siteId && !!selected.value && !!plan.value && !busy.value && !sameTemplate.value && !installed.value &&
            !importInProgress.value && !otherSite.value && conflicts.value.length === 0 && name.value.trim().length > 0);
        const previewUrl = computed(() => selected.value && origin && !selected.value.sourceCommit
            ? `${origin}/presets/${encodeURIComponent(selected.value.id)}?view=${view.value}` : '');

        async function refreshSite() {
            const wasImporting = site.value?.status === 'importing';
            const result = await sdk.send<{ site: SiteInstallation | null; checklist: ChecklistStep[];
                pageOptions: Record<string, { allowed: string[]; required: string }> }>({
                url: '/api/v4/presets/site', method: 'GET',
            });
            site.value = result.site;
            if (wasImporting && result.site?.status === 'ready') await selectSiteLanguage(result.site);
            checklist.value = result.checklist;
            pageOptions.value = result.pageOptions;
            if (result.site?.publishedTemplateRecord && result.site.presetManifestSnapshot) {
                try {
                    const record = JSON.parse(result.site.publishedTemplateRecord) as { sourceCommit: string; manifestChecksum: string };
                    const manifest = JSON.parse(result.site.presetManifestSnapshot) as PresetSummary & { demo: { hero: { image: string } } };
                    const installedSummary: PresetSummary = { ...manifest, ...record, heroImage: manifest.demo.hero.image };
                    if (!catalog.value.some((item) => presetKey(item) === presetKey(installedSummary))) catalog.value.push(installedSummary);
                } catch { /* The backend reports invalid persisted template data during validation. */ }
            }
            if (result.site) name.value = result.site.name;
            if (result.site && result.site.status !== 'empty') includeDemo.value = result.site.includeDemo;
        }

        async function selectSiteLanguage(installed: SiteInstallation) {
            await sdk.language.getAll({ skipCache: true });
            setLanguage(installed.language || 'en');
        }

        async function choosePreset(item: PresetSummary) {
            const key = presetKey(item);
            selectedKey.value = key;
            view.value = 'home';
            plan.value = null;
            error.value = '';
            try {
                const result = await sdk.send<{ plan: ImportPlan; installedSite: SiteInstallation | null }>({
                    url: `/api/v4/presets/plan/${encodeURIComponent(item.id)}${item.sourceCommit ? `?version=${encodeURIComponent(item.version)}` : ''}`, method: 'GET',
                });
                if (selectedKey.value === key) {
                    plan.value = result.plan;
                    if (result.installedSite && !site.value) site.value = result.installedSite;
                }
            } catch (cause) {
                error.value = userErrorMessage(cause);
            }
        }

        async function importSelected() {
            if (!canImport.value) return;
            busy.value = true;
            error.value = '';
            try {
                const result = await sdk.send<SiteInstallation>({
                    url: '/api/v4/presets/import', method: 'POST',
                    data: { presetId: selected.value!.id, siteName: name.value.trim(), includeDemo: includeDemo.value, mode: 'import',
                        ...(selected.value!.sourceCommit ? { presetVersion: selected.value!.version, manifestChecksum: selected.value!.manifestChecksum } : {}) },
                });
                site.value = result;
                if (result.status === 'ready') await selectSiteLanguage(result);
                await sdk.template.getAll({ skipCache: true });
                await refreshSite();
            } catch (cause) {
                error.value = userErrorMessage(cause);
                await refreshSite();
            } finally {
                busy.value = false;
            }
        }

        async function adoptSelected() {
            if (!canAdopt.value || !selected.value || !site.value) return;
            busy.value = true;
            error.value = '';
            try {
                await sdk.send<SiteInstallation>({ url: '/api/v4/presets/import', method: 'POST', data: {
                    presetId: selected.value.id, presetVersion: selected.value.version,
                    manifestChecksum: selected.value.manifestChecksum,
                    mode: 'adopt', expectedUpdatedAt: site.value.updatedAt,
                } });
                await refreshSite();
                window.bcms.notification.success(t('presets.versionAdopted'));
            } catch (cause) {
                error.value = userErrorMessage(cause);
                await refreshSite();
            } finally { busy.value = false; }
        }

        onMounted(async () => {
            refreshTimer = setInterval(() => {
                if (site.value?.status === 'importing') refreshSite().catch(() => undefined);
            }, 3000);
            try {
                const result = await sdk.send<{ items: PresetSummary[]; registryError?: string }>({
                    url: '/api/v4/presets/catalog', method: 'GET',
                });
                catalog.value = result.items;
                if (result.registryError) error.value = t('presets.registryUnavailable');
                await refreshSite();
                const first = catalog.value.find((item) => item.id === site.value?.presetId && item.version === site.value?.presetVersion &&
                    (!!item.sourceCommit === !!site.value?.publishedTemplateRecord)) || catalog.value[0];
                if (first) await choosePreset(first);
                if (result.registryError) error.value = t('presets.registryUnavailable');
            } catch (cause) {
                error.value = userErrorMessage(cause);
            } finally {
                loading.value = false;
            }
        });
        onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer); });

        const views: DemoView[] = ['home', 'collection', 'product', 'page'];

        return () => (
            <div class="px-4 pb-16 pt-8 md:px-8">
                <div class="mb-5 text-sm"><strong>{sdk.context?.workspace.name}</strong> · {site.value?.name || t('workspace.chooseSite')} <a class="ml-3 underline" href="/d/workspaces">{t('workspace.changeSelection')}</a></div>
                {!sdk.context?.context.siteId && <p class="mb-5 text-sm">{t('workspace.selectBeforeInstall')}</p>}
                <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 class="text-2xl font-semibold text-dark dark:text-white">{t('presets.title')}</h1>
                        <p class="mt-2 max-w-2xl text-sm text-dark/70 dark:text-light/70">{t('presets.subtitle')}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-4">
                        {site.value?.status === 'ready' && origin && <a
                            href={`/d/presets/site-preview?workspaceId=${encodeURIComponent(sdk.context?.context.workspaceId || '')}&siteId=${encodeURIComponent(sdk.context?.context.siteId || '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="border border-green px-3 py-2 text-sm font-medium text-green hover:bg-green/10 dark:border-yellow dark:text-yellow">
                            {t('presets.previewDraftSite')}
                        </a>}
                        {site.value?.status === 'ready' && (
                            <span class="text-sm text-green dark:text-yellow">{t('presets.installed', { name: site.value.name })} · v{site.value.presetVersion}</span>
                        )}
                    </div>
                </div>

                {error.value && <div role="alert" class="mb-6 border-l-4 border-red bg-error px-4 py-3 text-sm leading-relaxed text-dark">{error.value}</div>}
                {loading.value ? <p class="text-sm">{t('common.loading')}</p> : (
                    <>
                        <div class="grid gap-8 xl:grid-cols-[310px_minmax(0,1fr)]">
                            <section aria-label={t('presets.title')} class="min-w-0">
                                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                    {catalog.value.map((item) => (
                                        <button
                                            type="button"
                                            aria-pressed={selectedKey.value === presetKey(item)}
                                            onClick={() => choosePreset(item)}
                                            class={`overflow-hidden rounded-md border bg-white text-left shadow-sm transition-colors dark:bg-darkGray ${selectedKey.value === presetKey(item) ? 'border-green dark:border-yellow' : 'border-gray/60 dark:border-gray'}`}
                                        >
                                            <img src={item.heroImage} alt="" class="h-36 w-full object-cover" />
                                            <span class="block p-4">
                                                <strong class="block text-base">{item.name} <span class="text-xs">v{item.version}</span></strong>
                                                <span class="mt-1 block text-xs">{t(item.sourceCommit ? 'presets.publicSource' : 'presets.builtinSource')}</span>
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
                                            <span class="text-xs opacity-60">v{selected.value.version} · {t(selected.value.sourceCommit ? 'presets.publicSource' : 'presets.builtinSource')}</span>
                                            {selected.value.sourceCommit && <p class="mt-1 text-xs opacity-60">{t('presets.templateSource')} {selected.value.sourceCommit.slice(0, 8)}</p>}
                                        </div>
                                        {previewUrl.value && <div class="flex gap-1 rounded-md border border-gray/60 p-1 dark:border-gray" role="group" aria-label={t('presets.viewport')}>
                                            {(['desktop', 'mobile'] as const).map((mode) => (
                                                <button type="button" aria-pressed={viewport.value === mode} onClick={() => { viewport.value = mode; }}
                                                    class={`rounded px-3 py-1.5 text-sm ${viewport.value === mode ? 'bg-dark text-white dark:bg-light dark:text-dark' : ''}`}>
                                                    {t(`presets.${mode}`)}
                                                </button>
                                            ))}
                                        </div>}
                                    </div>
                                    {previewUrl.value && <div class="mb-3 flex flex-wrap gap-1 border-b border-gray/60 dark:border-gray" role="tablist">
                                        {views.map((item) => (
                                            <button type="button" role="tab" aria-selected={view.value === item} onClick={() => { view.value = item; }}
                                                class={`border-b-2 px-4 py-2 text-sm ${view.value === item ? 'border-green font-semibold dark:border-yellow' : 'border-transparent opacity-70'}`}>
                                                {t(`presets.views.${item}`)}
                                            </button>
                                        ))}
                                    </div>}
                                    <div class="flex h-[620px] justify-center overflow-hidden border border-gray/60 bg-white dark:border-gray" >
                                        {previewUrl.value ? <iframe key={previewUrl.value} title={t('presets.previewTitle', { name: selected.value.name })}
                                            src={previewUrl.value} class="h-full border-0 bg-white"
                                            style={{ width: viewport.value === 'mobile' ? '390px' : '100%', maxWidth: '100%' }} /> :
                                            <div class="flex w-full flex-col"><img src={selected.value.heroImage} alt={selected.value.name} class="min-h-0 flex-1 object-cover" />
                                                <p class="p-4 text-sm text-dark">{t('presets.publicPreviewHint')}</p></div>}
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
                                                <div class="border-b border-gray/60 py-2 text-sm dark:border-gray">
                                                    <div class="flex justify-between gap-3">
                                                        <span>{t(`presets.models.${item.key}`)}</span>
                                                        <span class={item.action === 'conflict' ? 'text-red' : 'opacity-60'}>{t(`presets.actions.${item.action}`)}</span>
                                                    </div>
                                                    {item.reason && <p role="alert" class="mt-2 text-xs leading-relaxed text-red">{userErrorMessage(item.reason)}</p>}
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
                                {sameTemplate.value && !installed.value && selected.value.sourceCommit && <div class="mt-5">
                                    <p class="mb-3 text-sm opacity-70">{t('presets.adoptHint', { version: selected.value.version })}</p>
                                    <Button disabled={!canAdopt.value} onClick={adoptSelected}>{t('presets.adoptVersion', { version: selected.value.version })}</Button>
                                </div>}
                                {installed.value ? <p class="mt-5 text-sm text-green dark:text-yellow">{t('presets.alreadyInstalled')}</p> : !sameTemplate.value && (
                                    <div class="mt-6 flex flex-wrap items-end gap-5">
                                        <label class="block min-w-[220px] flex-1 text-sm">
                                            <span class="mb-1 block">{t('presets.siteName')}</span>
                                            <input value={name.value} onInput={(event) => { name.value = (event.target as HTMLInputElement).value; }}
                                                maxlength={80} disabled={!!site.value} class="w-full rounded border border-gray bg-white px-3 py-2 text-dark dark:bg-darkGray dark:text-white" />
                                        </label>
                                        <label class="flex items-center gap-2 pb-2 text-sm">
                                            <input type="checkbox" checked={includeDemo.value} disabled={importOptionsLocked.value}
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

                        {site.value?.status === 'ready' && site.value.presetId === selected.value?.id &&
                            <PageDraftEditor site={site.value} pageOptions={pageOptions.value} onSaved={refreshSite} />}
                        {sameTemplate.value && <ReleaseManager key={site.value!._id} onSaved={refreshSite} />}

                        {site.value && (
                            <section class="mt-12 border-t border-gray/60 pt-8 dark:border-gray">
                                <h2 class="text-lg font-semibold">{t('presets.checklistTitle')}</h2>
                                <p class="mt-2 text-sm opacity-70">{t('presets.checklistSubtitle')}</p>
                                {site.value.status === 'failed' && <p role="alert" class="mt-3 text-sm text-red">{userErrorMessage(site.value.importError)}</p>}
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
