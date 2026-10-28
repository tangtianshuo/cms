import { computed, defineComponent, onMounted, ref } from 'vue';
import { throwable } from '@bcms/selfhosted-ui/util/throwable';
import { Loader } from '@bcms/selfhosted-ui/components/loader';
import { Button } from '@bcms/selfhosted-ui/components/button';
import type { UserStatsResponse } from '@bcms/selfhosted-backend/user/models/controller';
import { Link } from '@bcms/selfhosted-ui/components/link';
import { MediaPreview } from '@bcms/selfhosted-ui/components/media-preview';
import { UserList } from '@bcms/selfhosted-ui/components/user-list';
import { userHasRole } from '@bcms/selfhosted-ui/util/role';
import { useI18n } from 'vue-i18n';

export const HomeView = defineComponent({
    setup() {
        const { t } = useI18n();
        window.bcms.meta.set({ titleKey: 'routes.home' });
        const sdk = window.bcms.sdk;
        const modal = window.bcms.modalService;

        const loading = ref(true);
        const me = computed(() => sdk.store.user.methods.me());
        const userStats = ref<UserStatsResponse>();
        const recentMedia = computed(() =>
            sdk.store.media
                .items()
                .filter((e) => e.type !== 'DIR')
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 15),
        );

        function getStatBox(num: number | string, text: string) {
            return (
                <div
                    class="cms-panel flex flex-col items-start justify-center p-6"
                >
                    <div
                        class="text-3xl font-medium mb-4"
                    >
                        {num}
                    </div>
                    <div class={`leading-tight tracking-[-0.01em]`}>{text}</div>
                </div>
            );
        }

        onMounted(async () => {
            loading.value = true;
            await throwable(
                async () => {
                    await sdk.user.getAll();
                    await sdk.template.getAll();
                    await sdk.media.getAll();
                    return {
                        stats: await sdk.user.stats(),
                    };
                },
                async (result) => {
                    userStats.value = result.stats;
                },
            );
            loading.value = false;
        });

        return () => (
            <div class="cms-account-overview flex flex-col gap-8 w-full">
                {loading.value ? (
                    <div class={`m-auto`}>
                        <Loader show />
                    </div>
                ) : (
                    <>
                        <div class={`flex gap-4 w-full`}>
                            <div class={`flex flex-col gap-2`}>
                                <div
                                    class="text-2xl font-semibold mb-1"
                                >
                                    {t('views.home.greeting', {
                                        username: me.value?.username,
                                    })}
                                </div>
                                <div>{t('views.home.niceDay')}</div>
                            </div>
                            {/*{userHasRole(['ADMIN'], me.value) && (*/}
                            {/*    <Button*/}
                            {/*        class={`ml-auto mb-auto mt-2`}*/}
                            {/*        onClick={() => {}}*/}
                            {/*    >*/}
                            {/*        <div class={`flex gap-2 items-center`}>*/}
                            {/*            <div>Create new</div>*/}
                            {/*            <Icon*/}
                            {/*                class={`w-6 h-6 text-white fill-current`}*/}
                            {/*                src={`/plus`}*/}
                            {/*            />*/}
                            {/*        </div>*/}
                            {/*    </Button>*/}
                            {/*)}*/}
                        </div>
                        <div class={`flex flex-col gap-2`}>
                            <div
                                class={`text-base font-medium mb-5 dark:text-light`}
                            >
                                {t('views.home.statsTitle')}
                            </div>
                            <div
                                class={`grid grid-cols-1 gap-5 sm:grid-cols-3`}
                            >
                                {getStatBox(
                                    userStats.value?.entryCount || 0,
                                    t('views.home.entriesCreated'),
                                )}
                                {getStatBox(
                                    (
                                        (userStats.value?.mediaSize || 0) /
                                        1000000
                                    ).toFixed(0),
                                    t('views.home.megabytesUpload'),
                                )}
                                {getStatBox(
                                    sdk.store.user.items().length,
                                    t('views.home.members'),
                                )}
                            </div>
                        </div>
                        <div class="max-w-[500px]">
                            <div class="flex items-center justify-between mb-10">
                                <h2 class="text-base font-medium">
                                    {t('views.home.recentlyUploaded')}
                                </h2>
                                {recentMedia.value.length > 0 && (
                                    <Link
                                        href="/d/media"
                                        class="leading-tight tracking-[-0.01em] text-green hover:underline dark:text-yellow"
                                    >
                                        {t('views.home.seeAllFiles')}
                                    </Link>
                                )}
                            </div>
                            {recentMedia.value.length > 0 ? (
                                <div class="grid grid-cols-5 gap-2.5">
                                    {recentMedia.value.map((media, index) => {
                                        return (
                                            <Link
                                                href={`/d/media?search=${media._id}`}
                                                class="flex aspect-square w-full max-h-20"
                                            >
                                                <MediaPreview
                                                    thumbnail
                                                    key={index}
                                                    media={media}
                                                    class="p-0.5 w-full h-full  object-cover"
                                                />
                                            </Link>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div>
                                    {userHasRole(['ADMIN'], me.value) && (
                                        <Button
                                            class="mb-6"
                                            onClick={() => {
                                                modal.handlers.mediaCreateFile.open();
                                            }}
                                        >
                                            {t('views.home.uploadFiles')}
                                        </Button>
                                    )}
                                    <div class="leading-tight tracking-[-0.01em] mb-8 dark:text-light">
                                        {t('views.home.uploadFirst')}
                                    </div>
                                </div>
                            )}
                        </div>
                        <section class="cms-panel"><UserList class="w-full" /></section>
                    </>
                )}
            </div>
        );
    },
});
export default HomeView;
