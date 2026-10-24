import {
    computed,
    defineComponent,
    onBeforeUnmount,
    ref,
    watch,
    type PropType,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { Prop } from '@bcms/selfhosted-backend/prop/models/main';
import type { EntryGroup } from '@bcms/selfhosted-backend/entry-groups/repo';
import type {
    ResourceShare,
    ShareKind,
    SharedResource,
} from '@bcms/selfhosted-backend/resource-shares/repo';
import type { CopySelection } from '@bcms/selfhosted-backend/resource-shares/graph';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { errorMessage, formClass, panelClass } from './common';
export type ShareSummary = Omit<
    ResourceShare,
    'snapshot' | 'entryProps' | 'activeCopies' | 'mediaStorageId'
>;
interface Preview extends ShareSummary {
    item: SharedResource;
    entryProps?: Prop[];
}

export const ShareCopy = defineComponent({
    props: {
        items: { type: Array as PropType<ShareSummary[]>, required: true },
        groups: { type: Array as PropType<EntryGroup[]>, required: true },
        onCopied: {
            type: Function as PropType<() => Promise<void>>,
            required: true,
        },
    },
    setup(props) {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const root = ref('');
        const previews = ref<Record<string, Preview>>({});
        const selections = ref<Record<string, CopySelection>>({});
        const mediaUrls = ref<Record<string, string>>({});
        const error = ref('');
        const busy = ref(false);
        const result = ref('');
        const rootShare = computed(() =>
            props.items.find((item) => item._id === root.value),
        );
        const candidates = computed(() =>
            props.items.filter(
                (item) =>
                    item.state === 'active' &&
                    (!rootShare.value ||
                        item.ownerWorkspaceId ===
                            rootShare.value.ownerWorkspaceId),
            ),
        );
        const writeAllowed = sdk.context?.context.role !== 'viewer';
        let alive = true;
        let generation = 0;
        const loading = ref(0);
        function releasePreviews() {
            for (const url of Object.values(mediaUrls.value))
                URL.revokeObjectURL(url);
            mediaUrls.value = {};
        }
        onBeforeUnmount(() => {
            alive = false;
            releasePreviews();
        });
        function targetProps(id: string): Prop[] {
            const share = previews.value[id];
            const choice = selections.value[id];
            if (!choice || !share) return [];
            if (share.resourceType === 'Entry')
                return (
                    sdk.store.template.findById(choice.templateId || '')
                        ?.props || []
                );
            if (choice.targetId)
                return (
                    (share.resourceType === 'Widget'
                        ? sdk.store.widget
                        : sdk.store.group
                    ).findById(choice.targetId)?.props || []
                );
            return [];
        }
        function sourceProps(id: string) {
            const share = previews.value[id];
            return share?.resourceType === 'Entry'
                ? share.entryProps || []
                : (share?.item as { props?: Prop[] })?.props || [];
        }
        function remap(id: string) {
            const targets = targetProps(id);
            selections.value[id].fieldMap = Object.fromEntries(
                sourceProps(id).map((source) => [
                    source.id,
                    targets.find(
                        (target) =>
                            target.name === source.name &&
                            target.type === source.type &&
                            target.array === source.array &&
                            target.required === source.required,
                    )?.id || '',
                ]),
            );
        }
        async function preview(
            id: string,
            sequence = generation,
        ): Promise<boolean> {
            loading.value++;
            try {
                const data = await sdk.send<Preview>({
                    url: `/api/v4/resource-shares/${encodeURIComponent(id)}`,
                });
                const current = () =>
                    alive &&
                    sequence === generation &&
                    props.items.some(
                        (item) =>
                            item._id === id &&
                            item.state === 'active' &&
                            item.version === data.version,
                    );
                if (!current()) return false;
                previews.value[id] = data;
                if (data.resourceType === 'Media' && !mediaUrls.value[id]) {
                    const blob = await sdk.send<Blob>({
                        url: `/api/v4/resource-shares/${encodeURIComponent(
                            id,
                        )}/media`,
                        responseType: 'blob',
                    });
                    if (!current()) return false;
                    mediaUrls.value[id] = URL.createObjectURL(blob);
                }
                return current();
            } catch (cause) {
                if (alive && sequence === generation)
                    error.value = errorMessage(cause);
                return false;
            } finally {
                loading.value--;
            }
        }
        async function toggle(id: string, selected: boolean) {
            if (!selected) {
                delete selections.value[id];
                return;
            }
            const sequence = generation;
            if (!(await preview(id, sequence)) || sequence !== generation)
                return;
            selections.value[id] = {
                shareId: id,
                ...(previews.value[id].resourceType === 'Entry'
                    ? {
                          templateId: '',
                          groupId: props.groups[0]?._id || '',
                          fieldMap: {},
                      }
                    : {}),
            };
        }
        async function chooseRoot(id: string) {
            generation++;
            root.value = id;
            selections.value = {};
            result.value = '';
            error.value = '';
            releasePreviews();
            previews.value = {};
            if (id) await toggle(id, true);
        }
        watch(
            () => props.items,
            (items) => {
                const active = new Map(
                    items
                        .filter((item) => item.state === 'active')
                        .map((item) => [item._id, item.version]),
                );
                if (root.value && !active.has(root.value)) {
                    generation++;
                    root.value = '';
                    selections.value = {};
                    previews.value = {};
                    releasePreviews();
                    return;
                }
                for (const id of Object.keys(previews.value)) {
                    if (active.get(id) === previews.value[id].version) continue;
                    delete previews.value[id];
                    delete selections.value[id];
                    if (mediaUrls.value[id])
                        URL.revokeObjectURL(mediaUrls.value[id]);
                    delete mediaUrls.value[id];
                }
            },
        );
        async function copy() {
            if (!root.value || busy.value || loading.value) return;
            busy.value = true;
            error.value = '';
            result.value = '';
            try {
                const copied = await sdk.send<{
                    batchId: string;
                    rootId: string;
                    items: Array<{ resourceType: ShareKind; id: string }>;
                }>({
                    url: `/api/v4/resource-shares/${encodeURIComponent(
                        root.value,
                    )}/copy`,
                    method: 'POST',
                    data: {
                        resources: Object.values(selections.value).map(
                            (choice) => ({
                                ...choice,
                                targetId: choice.targetId || undefined,
                            }),
                        ),
                    },
                });
                result.value = t('shares.copiedResult', {
                    id: copied.rootId,
                    batch: copied.batchId,
                });
                root.value = '';
                selections.value = {};
                previews.value = {};
                releasePreviews();
                await Promise.allSettled([
                    sdk.template.getAll({ skipCache: true }),
                    sdk.widget.getAll({ skipCache: true }),
                    sdk.group.getAll({ skipCache: true }),
                    sdk.media.getAll({ skipCache: true }),
                    sdk.entry.getAllLite({ skipCache: true }),
                ]);
                await props.onCopied();
            } catch (cause) {
                error.value = `${errorMessage(cause)} ${
                    (cause as { status?: number }).status === 409
                        ? t('shares.conflict')
                        : ''
                }`;
                try {
                    await props.onCopied();
                } catch {
                    /* Keep the actionable copy error visible. */
                }
            } finally {
                busy.value = false;
            }
        }
        function mapping(id: string) {
            const choice = selections.value[id];
            if (!choice) return null;
            return (
                <fieldset class="mt-4 grid gap-3">
                    <legend class="text-sm font-semibold">
                        {t('shares.fieldMapping')}
                    </legend>
                    {sourceProps(id).map((source) => (
                        <label class="grid gap-2 text-sm sm:grid-cols-2">
                            <span>
                                {source.label} · {source.type}
                                {source.array ? '[]' : ''}
                                {source.required ? ' *' : ''}
                            </span>
                            <select
                                class={formClass}
                                value={choice.fieldMap?.[source.id] || ''}
                                disabled={!!loading.value || busy.value}
                                onChange={(event) => {
                                    choice.fieldMap = {
                                        ...choice.fieldMap,
                                        [source.id]: (
                                            event.target as HTMLSelectElement
                                        ).value,
                                    };
                                }}
                            >
                                <option value="">
                                    {t('shares.chooseField')}
                                </option>
                                {targetProps(id)
                                    .filter(
                                        (target) => target.type === source.type,
                                    )
                                    .map((target) => (
                                        <option value={target.id}>
                                            {target.label} ({target.name})
                                        </option>
                                    ))}
                            </select>
                        </label>
                    ))}
                </fieldset>
            );
        }
        return () => (
            <section class={panelClass}>
                <h2 class="text-lg font-semibold">{t('shares.accept')}</h2>
                <p class="mt-2 text-sm opacity-70">{t('shares.copyHint')}</p>
                <label class="mt-4 block text-sm">
                    {t('shares.root')}{' '}
                    <select
                        class={`${formClass} ml-2 max-w-full`}
                        value={root.value}
                        disabled={!!loading.value || busy.value}
                        onChange={(event) =>
                            chooseRoot(
                                (event.target as HTMLSelectElement).value,
                            )
                        }
                    >
                        <option value="">{t('shares.chooseResource')}</option>
                        {props.items
                            .filter((item) => item.state === 'active')
                            .map((item) => (
                                <option value={item._id}>
                                    {item.resourceType} · {item.resourceId} ·{' '}
                                    {item.version.slice(0, 10)}
                                </option>
                            ))}
                    </select>
                </label>
                {error.value && (
                    <p role="alert" class="mt-4 text-sm text-red">
                        {error.value}
                    </p>
                )}
                {result.value && (
                    <p role="status" class="mt-4 text-sm">
                        {result.value}
                    </p>
                )}
                {candidates.value.map((item) => (
                    <article class="mt-4 border border-gray/50 p-4">
                        <div class="flex flex-wrap items-center gap-3">
                            <label class="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={!!selections.value[item._id]}
                                    disabled={
                                        !root.value ||
                                        item._id === root.value ||
                                        !!loading.value ||
                                        busy.value
                                    }
                                    onChange={(event) =>
                                        toggle(
                                            item._id,
                                            (event.target as HTMLInputElement)
                                                .checked,
                                        )
                                    }
                                />
                                {item.resourceType} ·{' '}
                                <code class="break-all">{item.resourceId}</code>
                            </label>
                            <Button
                                disabled={!!loading.value || busy.value}
                                onClick={() => preview(item._id)}
                            >
                                {t('shares.preview')}
                            </Button>
                        </div>
                        <p class="mt-2 break-all text-xs opacity-70">
                            {t('shares.source', {
                                workspace: item.ownerWorkspaceId,
                                version: item.version,
                            })}
                        </p>
                        {previews.value[item._id] && (
                            <details class="mt-3">
                                <summary class="cursor-pointer text-sm">
                                    {t('shares.snapshot')}
                                </summary>
                                <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                                    {JSON.stringify(
                                        previews.value[item._id].item,
                                        null,
                                        2,
                                    )}
                                </pre>
                            </details>
                        )}
                        {mediaUrls.value[item._id] && (
                            <a
                                href={mediaUrls.value[item._id]}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="mt-3 block text-sm underline"
                            >
                                {t('shares.openMedia')}
                            </a>
                        )}
                        {selections.value[item._id] &&
                            item.resourceType === 'Entry' && (
                                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                                    <label class="text-sm">
                                        {t('shares.targetTemplate')}
                                        <select
                                            class={`${formClass} mt-2 block w-full`}
                                            value={
                                                selections.value[item._id]
                                                    .templateId || ''
                                            }
                                            disabled={
                                                !!loading.value || busy.value
                                            }
                                            onChange={(event) => {
                                                selections.value[
                                                    item._id
                                                ].templateId = (
                                                    event.target as HTMLSelectElement
                                                ).value;
                                                remap(item._id);
                                            }}
                                        >
                                            <option value="">
                                                {t('shares.chooseTemplate')}
                                            </option>
                                            {sdk.store.template
                                                .items()
                                                .filter(
                                                    (template) =>
                                                        !template.singleEntry,
                                                )
                                                .map((template) => (
                                                    <option
                                                        value={template._id}
                                                    >
                                                        {template.label}
                                                    </option>
                                                ))}
                                        </select>
                                    </label>
                                    <label class="text-sm">
                                        {t('entryGroups.selection')}
                                        <select
                                            class={`${formClass} mt-2 block w-full`}
                                            value={
                                                selections.value[item._id]
                                                    .groupId || ''
                                            }
                                            disabled={
                                                !!loading.value || busy.value
                                            }
                                            onChange={(event) => {
                                                selections.value[
                                                    item._id
                                                ].groupId = (
                                                    event.target as HTMLSelectElement
                                                ).value;
                                            }}
                                        >
                                            <option value="">
                                                {t('entryGroups.choose')}
                                            </option>
                                            {props.groups.map((group) => (
                                                <option value={group._id}>
                                                    {group.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            )}
                        {selections.value[item._id] &&
                            ['Widget', 'Group'].includes(item.resourceType) &&
                            item._id !== root.value && (
                                <label class="mt-4 block text-sm">
                                    {t('shares.structureTarget')}
                                    <select
                                        class={`${formClass} mt-2 block w-full`}
                                        value={
                                            selections.value[item._id]
                                                .targetId || ''
                                        }
                                        disabled={!!loading.value || busy.value}
                                        onChange={(event) => {
                                            selections.value[
                                                item._id
                                            ].targetId =
                                                (
                                                    event.target as HTMLSelectElement
                                                ).value || undefined;
                                            remap(item._id);
                                        }}
                                    >
                                        <option value="">
                                            {t('shares.newStructure')}
                                        </option>
                                        {(item.resourceType === 'Widget'
                                            ? sdk.store.widget
                                            : sdk.store.group
                                        )
                                            .items()
                                            .map((structure) => (
                                                <option value={structure._id}>
                                                    {structure.label}
                                                </option>
                                            ))}
                                    </select>
                                </label>
                            )}
                        {selections.value[item._id] &&
                            (item.resourceType === 'Entry' ||
                                selections.value[item._id].targetId) &&
                            mapping(item._id)}
                    </article>
                ))}
                <Button
                    class="mt-5"
                    disabled={
                        !!loading.value ||
                        busy.value ||
                        !writeAllowed ||
                        !root.value ||
                        !selections.value[root.value]
                    }
                    onClick={copy}
                >
                    {t('shares.copy')}
                </Button>
                {!writeAllowed && (
                    <p class="mt-3 text-sm">{t('shares.viewerHint')}</p>
                )}
            </section>
        );
    },
});
