import { defineComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { EntryGroup } from '@bcms/selfhosted-backend/entry-groups/repo';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { errorMessage, formClass, panelClass } from './common';
export const EntryGroupManager = defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const groups = ref<EntryGroup[]>([]);
        const names = ref<Record<string, string>>({});
        const name = ref('');
        const error = ref('');
        const busy = ref(false);
        const admin = !!sdk.context?.context.admin;
        async function refresh() {
            const result = await sdk.send<{ items: EntryGroup[] }>({
                url: '/api/v4/entry-groups/',
            });
            groups.value = result.items;
            names.value = Object.fromEntries(
                result.items.map((item) => [item._id, item.name]),
            );
        }
        async function run(action: () => Promise<unknown>) {
            if (busy.value) return;
            busy.value = true;
            error.value = '';
            try {
                await action();
                await refresh();
            } catch (cause) {
                error.value = errorMessage(cause);
            } finally {
                busy.value = false;
            }
        }
        onMounted(() => run(async () => undefined));
        return () => (
            <section>
                <h1 class="text-2xl font-semibold">
                    {t('workspace.entry-groups')}
                </h1>
                <p class="mt-2 text-sm opacity-70">{t('entryGroups.hint')}</p>
                {error.value && (
                    <p role="alert" class="mt-4 text-red">
                        {error.value}
                    </p>
                )}
                {admin && (
                    <form
                        class={`${panelClass} flex flex-wrap gap-3`}
                        onSubmit={(event) => {
                            event.preventDefault();
                            run(async () => {
                                await sdk.send({
                                    url: '/api/v4/entry-groups/',
                                    method: 'POST',
                                    data: { name: name.value.trim() },
                                });
                                name.value = '';
                            });
                        }}
                    >
                        <input
                            class={formClass}
                            aria-label={t('entryGroups.name')}
                            value={name.value}
                            required
                            maxlength={80}
                            onInput={(event) => {
                                name.value = (
                                    event.target as HTMLInputElement
                                ).value;
                            }}
                        />
                        <Button
                            type="submit"
                            disabled={busy.value || !name.value.trim()}
                        >
                            {t('common.create')}
                        </Button>
                    </form>
                )}
                {groups.value.map((group) => (
                    <form
                        class={`${panelClass} flex flex-wrap items-center gap-3`}
                        onSubmit={(event) => {
                            event.preventDefault();
                            run(() =>
                                sdk.send({
                                    url: `/api/v4/entry-groups/${encodeURIComponent(
                                        group._id,
                                    )}`,
                                    method: 'PUT',
                                    data: {
                                        name: names.value[group._id].trim(),
                                    },
                                }),
                            );
                        }}
                    >
                        <input
                            class={formClass}
                            aria-label={t('entryGroups.name')}
                            disabled={!admin || busy.value}
                            value={names.value[group._id]}
                            required
                            maxlength={80}
                            onInput={(event) => {
                                names.value[group._id] = (
                                    event.target as HTMLInputElement
                                ).value;
                            }}
                        />
                        <code class="text-xs break-all">{group._id}</code>
                        {admin && (
                            <>
                                <Button type="submit" disabled={busy.value}>
                                    {t('common.update')}
                                </Button>
                                <Button
                                    type="button"
                                    kind="danger"
                                    disabled={busy.value}
                                    onClick={async () => {
                                        if (
                                            await window.bcms.confirm(
                                                t('common.delete'),
                                                t('entryGroups.deleteHint'),
                                            )
                                        )
                                            await run(() =>
                                                sdk.send({
                                                    url: `/api/v4/entry-groups/${encodeURIComponent(
                                                        group._id,
                                                    )}`,
                                                    method: 'DELETE',
                                                }),
                                            );
                                    }}
                                >
                                    {t('common.delete')}
                                </Button>
                            </>
                        )}
                    </form>
                ))}
            </section>
        );
    },
});
