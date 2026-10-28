import { computed, defineComponent, onMounted } from 'vue';
import { useMedia } from '@bcms/selfhosted-ui/hooks/media';
import { Icon } from '@bcms/selfhosted-ui/components/icon';
import { EmptyState } from '@bcms/selfhosted-ui/components/empty-state';
import { Breadcrumb } from '@bcms/selfhosted-ui/components/media/breadcrumb';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { MediaList } from '@bcms/selfhosted-ui/components/media/list';
import { useRoute, useRouter } from 'vue-router';
import type { Media } from '@bcms/selfhosted-backend/media/models/main';
import { useI18n } from 'vue-i18n';

export const MediaView = defineComponent({
    setup() {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const modal = window.bcms.modalService;
        const route = useRoute();
        const router = useRouter();

        const {
            mediaData,
            mediaSortDirection,
            setMediaSort,
            setMediaParent,
            mediaActiveParent,
            searchMedia,
        } = useMedia();
        const isEmpty = computed(() => sdk.store.media.items().length === 0);

        onMounted(async () => {
            if (typeof route.query.parentId === 'string') {
                setMediaParent(route.query.parentId);
            }
        });

        async function setActiveDir(media?: Media) {
            if (media) {
                await router.replace(`/d/media?parentId=${media._id}`);
            } else {
                await router.replace(`/d/media`);
            }
            setMediaParent(media?._id);
        }

        function sortFilesComponent() {
            return (
                <button
                    onClick={() => {
                        setMediaSort((mediaSortDirection.value * -1) as 1 | -1);
                    }}
                    class="flex items-center transition-colors duration-300 group text-dark hover:text-opacity-60 focus-visible:text-opacity-60 dark:text-light"
                >
                    <span class="text-xs leading-normal uppercase mr-1.5">
                        {t('views.media.sortName')}
                    </span>
                    <div
                        class={
                            mediaSortDirection.value === 1 ? 'rotate-180' : ''
                        }
                    >
                        <Icon
                            src="/arrow/up"
                            class="w-3 h-3 transition-colors duration-300 fill-current"
                        />
                    </div>
                </button>
            );
        }

        return () => (
            <div class="cms-media-page">
                <div class="cms-admin-heading"><div><p class="cms-admin-eyebrow">MEDIA MANAGEMENT</p><h1>{t('routes.media')}</h1><p class="cms-page-description">上传、整理并复用网站的图片与文件。</p></div><a class="cms-admin-text-link" href="/d/shares?type=Media">{t('shares.grant')}</a></div>
                <header class="cms-media-toolbar">
                    <div class="cms-media-search">
                        <Icon
                            src={`/search`}
                            class="cms-media-search-icon"
                        />
                        <input
                            aria-label={t('common.search')} class="cms-media-search-input"
                            type="text"
                            placeholder={t('common.search')}
                            onInput={(event) => {
                                const el = event.target as HTMLInputElement;
                                if (el) {
                                    searchMedia(el.value);
                                }
                            }}
                        />
                    </div>
                    <div class={`flex gap-2`}>
                        <Button
                            onClick={() => {
                                modal.handlers.mediaCreateFile.open();
                            }}
                        >
                            {t('views.media.uploadFile')}
                        </Button>
                        <Button
                            kind={'secondary'}
                            class=""
                            onClick={() => {
                                modal.handlers.mediaCreateDir.open();
                            }}
                        >
                            {t('views.media.createFolder')}
                        </Button>
                    </div>
                </header>
                {isEmpty.value ? (
                    <>
                        <div class="cms-media-empty-label">
                            {t('views.media.empty')}
                        </div>
                        <EmptyState
                            src="/media.png"
                            maxWidth="350px"
                            maxHeight="315px"
                            class="mt-20 md:absolute md:bottom-32 md:right-32"
                        />
                    </>
                ) : (
                    <div class="mt-6 pb-6">
                        <div class={`flex items-center justify-between`}>
                            {mediaActiveParent.value ? (
                                <Breadcrumb
                                    onClick={async (media) => {
                                        await setActiveDir(media);
                                    }}
                                />
                            ) : (
                                <h2 class="text-base font-medium">全部素材</h2>
                            )}
                            {sortFilesComponent()}
                        </div>
                        <MediaList
                            class={`mt-10`}
                            items={mediaData.value.dirs}
                            onClick={async (media) => {
                                await setActiveDir(media);
                            }}
                        />
                        <MediaList
                            class={`mt-10`}
                            items={mediaData.value.files}
                        />
                    </div>
                )}
            </div>
        );
    },
});

export default MediaView;
