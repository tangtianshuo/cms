import {
    computed,
    defineComponent,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import { EntrySync } from '@bcms/selfhosted-ui/services/entry-sync';
import { PropValidator } from '@bcms/selfhosted-ui/util/prop-validation';
import type { Language } from '@bcms/selfhosted-backend/language/models/main';
import { entryNewFromTemplate } from '@bcms/selfhosted-ui/util/entry';
import type {
    EntryContentNode,
    EntryContentNodeWidgetAttr,
} from '@bcms/selfhosted-backend/entry/models/content';
import { EntrySyncElements } from '@bcms/selfhosted-ui/components/entry/sync-elements/main';
import { LanguageSwitch } from '@bcms/selfhosted-ui/components/language-switch';
import { EntryStatusSelect } from '@bcms/selfhosted-ui/components/inputs/select/entry-status';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { EntryEditor } from '@bcms/selfhosted-ui/components/entry/editor';
import { StringUtility } from '@bcms/selfhosted-utils/string-utility';
import { Loader } from '@bcms/selfhosted-ui/components/loader';
import { useI18n } from 'vue-i18n';
import { ProductPreview } from '@bcms/selfhosted-ui/components/storefront/product-preview';
import { PagePreview } from '@bcms/selfhosted-ui/components/storefront/page-preview';
import { buildEntryCreateBody } from '@bcms/selfhosted-ui/util/entry-create';
import { availablePreviewPages } from '@bcms/selfhosted-ui/util/page-preview';
import type { PreviewSiteContext } from '@bcms/selfhosted-ui/util/page-preview';

export const EntryView = defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const throwable = window.bcms.throwable;
        const meta = window.bcms.meta;
        const notification = window.bcms.notification;
        const [lngCode] = window.bcms.useLanguage();

        const route = useRoute();
        const router = useRouter();

        const loading = ref(true);
        const saving = ref(false);
        const slugLocked = ref(false);
        const propValidator: PropValidator = new PropValidator();
        window.bcms.entryPropValidator = propValidator;

        const template = computed(() =>
            sdk.store.template.find((e) => e._id === route.params.templateId),
        );
        const entry = ref<Entry>();
        const installedSite = ref<PreviewSiteContext | null>(null);
        const hasPagePreview = computed(() => Boolean(entry.value &&
            availablePreviewPages(installedSite.value, entry.value.templateId).length));
        const lngIdx = computed(() => {
            const idx = entry.value?.meta.findIndex(
                (e) => e.lng === lngCode.value,
            );
            if (typeof idx === 'undefined') {
                return -1;
            }
            return idx;
        });
        const entryLngChanges = ref<{
            [lngCode: string]: {
                change: boolean;
                buffer: string;
            };
        }>({});
        const checkForChangesInterval = setInterval(() => {
            const languages = sdk.store.language.items();
            for (let i = 0; i < languages.length; i++) {
                const language = languages[i];
                const data = getEntryStateHash(language);
                const tracked = entryLngChanges.value[language.code];
                if (tracked)
                    tracked.change =
                        route.params.entryId === 'create' ||
                        data !== tracked.buffer;
            }
        }, 1000);
        const entrySync = shallowRef<EntrySync>();

        function ensureEntrySync() {
            if (!entrySync.value) {
                entrySync.value = new EntrySync(
                    () => entry.value?._id || '',
                    () => entry.value,
                    (ent) => {
                        entry.value = ent;
                    },
                    () => lngCode.value,
                    () => lngIdx.value,
                );
            }
            return entrySync.value;
        }

        meta.set({ titleKey: 'routes.entry' });

        function getEntryStateHash(language: Language) {
            return (
                JSON.stringify(
                    entry.value?.meta.find((e) => e.lng === language.code) ||
                        {},
                ) +
                    JSON.stringify(
                        entry.value?.content.find(
                            (e) => e.lng === language.code,
                        ) || {},
                    ) +
                    entry.value?.statuses.find((e) => e.lng === language.code)
                        ?.id || 'undefined'
            );
        }

        function beforeUnload() {
            entrySync.value?.destroy();
        }

        onMounted(async () => {
            loading.value = true;
            await throwable(async () => {
                await sdk.template.getAll();
                if (!template.value) {
                    throw Error(t('views.entry.templateMissing'));
                }
                try {
                    const result = await sdk.send<{ site: PreviewSiteContext | null }>({
                        url: `/api/v4/presets/preview-context/${encodeURIComponent(template.value._id)}`,
                        method: 'GET',
                    });
                    installedSite.value = result.site;
                } catch {
                    installedSite.value = null;
                }
                await sdk.widget.getAll();
                await sdk.group.getAll();
                const languages = await sdk.language.getAll();
                if (route.params.entryId === 'create') {
                    entry.value = await entryNewFromTemplate(template.value);
                    for (const language of languages) {
                        entryLngChanges.value[language.code] = {
                            change: true,
                            buffer: getEntryStateHash(language),
                        };
                    }
                    return;
                }
                const ent = await sdk.entry.get({
                    entryId: route.params.entryId as string,
                    templateId: template.value._id,
                });

                const backendEntry = await entryNewFromTemplate(
                    template.value,
                    ent,
                );
                entry.value = JSON.parse(JSON.stringify(backendEntry));
                if (entry.value?.meta[lngIdx.value]) {
                    meta.set({
                        title: (
                            entry.value.meta[lngIdx.value].props[0]
                                .data as string[]
                        )[0],
                    });
                    if (
                        (
                            entry.value.meta[lngIdx.value].props[1]
                                .data as string[]
                        )[0]
                    ) {
                        slugLocked.value = true;
                    }
                }
                for (let i = 0; i < languages.length; i++) {
                    entryLngChanges.value[languages[i].code] = {
                        change: false,
                        buffer: getEntryStateHash(languages[i]),
                    };
                }
                await ensureEntrySync().sync();
            });
            loading.value = false;
            window.addEventListener('beforeunload', beforeUnload);
        });

        onBeforeUnmount(() => {
            window.removeEventListener('beforeunload', beforeUnload);
            clearInterval(checkForChangesInterval);
            beforeUnload();
        });

        async function update() {
            if (saving.value) return;
            if (!propValidator.validate()) {
                notification.warning(t('views.entry.errors'));
                return;
            }
            if (entry.value) {
                saving.value = true;
                const creating = route.params.entryId === 'create';
                const data = entry.value;
                try {
                    await throwable(
                        async () => {
                            if (creating) {
                                const created = await sdk.entry.create({
                                    templateId: data.templateId,
                                    data: buildEntryCreateBody(data),
                                });
                                entry.value = await entryNewFromTemplate(
                                    template.value!,
                                    created,
                                );
                                await router.replace(
                                    `/d/template/${data.templateId}/entry/${created._id}`,
                                );
                                await ensureEntrySync().sync();
                                return;
                            }
                            await sdk.entry.update({
                                _id: data?._id,
                                templateId: data.templateId,
                                lng: lngCode.value,
                                status: data?.statuses.find(
                                    (e) => e.lng === lngCode.value,
                                )?.id,
                                meta: {
                                    props: data?.meta[lngIdx.value].props,
                                },
                                content: {
                                    nodes: data?.content[
                                        lngIdx.value
                                    ].nodes.map((node) => {
                                        if (node.type === 'widget') {
                                            const outputNode: EntryContentNode =
                                                JSON.parse(
                                                    JSON.stringify(node),
                                                );
                                            const attrs =
                                                outputNode.attrs as EntryContentNodeWidgetAttr;
                                            attrs.data = JSON.parse(
                                                attrs.data as unknown as string,
                                            );
                                            delete (attrs as any).widgetId;
                                            return outputNode;
                                        }
                                        return node;
                                    }),
                                },
                            });
                        },
                        async () => {
                            const language = sdk.store.language.find(
                                (item) => item.code === lngCode.value,
                            );
                            if (
                                language &&
                                entryLngChanges.value[language.code]
                            ) {
                                entryLngChanges.value[language.code].buffer =
                                    getEntryStateHash(language);
                                entryLngChanges.value[language.code].change =
                                    false;
                            }
                            notification.success(
                                creating
                                    ? t('views.entry.created')
                                    : t('views.entry.updated', {
                                          language: lngCode.value,
                                      }),
                            );
                        },
                    );
                } finally {
                    saving.value = false;
                }
            }
        }

        return () => (
            <div>
                {template.value && entry.value && lngIdx.value !== -1 ? (
                    <div
                        class={`flex flex-col mt-8 pl-8 ${
                            loading.value ? 'opacity-0' : ''
                        }`}
                    >
                        {entrySync.value && (
                            <EntrySyncElements entrySync={entrySync.value} />
                        )}
                        <div
                            class={`desktop:fixed desktop:right-6 desktop:top-6 flex gap-2 items-center top-0 max-desktop:top-14 z-20 pb-8`}
                        >
                            <div
                                class={`ml-auto flex max-desktop:flex-col gap-4 items-center max-desktop:items-end`}
                            >
                                <div
                                    id={`entrySync-connected-users-container`}
                                    class={`flex items-center gap-1`}
                                />
                                <LanguageSwitch fixed />
                                <EntryStatusSelect
                                    fixed
                                    selected={
                                        entry.value?.statuses.find(
                                            (e) => e.lng === lngCode.value,
                                        )?.id
                                    }
                                    onChange={(status) => {
                                        if (entry.value) {
                                            let found = false;
                                            for (
                                                let i = 0;
                                                i < entry.value.statuses.length;
                                                i++
                                            ) {
                                                if (
                                                    entry.value.statuses[i]
                                                        .lng === lngCode.value
                                                ) {
                                                    entry.value.statuses[i].id =
                                                        status._id;
                                                    found = true;
                                                    break;
                                                }
                                            }
                                            if (!found) {
                                                entry.value.statuses.push({
                                                    lng: lngCode.value,
                                                    id: status._id,
                                                });
                                            }
                                        }
                                    }}
                                />
                                {installedSite.value && entry.value && hasPagePreview.value &&
                                    <PagePreview entry={entry.value} site={installedSite.value} language={lngCode.value} />}
                                <Button
                                    disabled={
                                        saving.value ||
                                        !entryLngChanges.value[lngCode.value]
                                            ?.change
                                    }
                                    onClick={async () => {
                                        await update();
                                    }}
                                >
                                    {route.params.entryId === 'create'
                                        ? t('common.create')
                                        : t('common.update')}
                                </Button>
                            </div>
                        </div>
                        {!loading.value && (
                            <div
                                class={
                                    template.value.name === 'product' && !hasPagePreview.value
                                        ? 'grid grid-cols-1 2xl:grid-cols-[minmax(0,600px)_minmax(360px,1fr)] gap-8 pr-8'
                                        : ''
                                }
                            >
                                <EntryEditor
                                    key={entry.value._id || 'create'}
                                    entry={entry.value}
                                    propValidator={propValidator}
                                    entrySync={entrySync.value}
                                    onEditTitle={(value) => {
                                        meta.set({ title: value });
                                        if (entry.value) {
                                            (
                                                entry.value.meta[lngIdx.value]
                                                    .props[0].data as string[]
                                            )[0] = value;
                                            if (!slugLocked.value) {
                                                (
                                                    entry.value.meta[
                                                        lngIdx.value
                                                    ].props[1].data as string[]
                                                )[0] =
                                                    StringUtility.toSlug(value);
                                            }
                                        }
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
                                {template.value.name === 'product' && !hasPagePreview.value && (
                                    <ProductPreview entry={entry.value} />
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    ''
                )}
                <div class={`w-full h-full flex items-center justify-center`}>
                    <Loader show={loading.value} />
                </div>
            </div>
        );
    },
});

export default EntryView;
