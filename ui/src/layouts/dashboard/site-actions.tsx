import { defineComponent } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { StudioIcon } from '../../components/studio/icon';
import { siteSetupHref } from './navigation';

/** Setup can target a new site while the SDK still points to the previous site. */
export const DashboardSiteActions = defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        return () =>
            route.path === siteSetupHref ? null : (
                <>
                    {sdk.context?.site && (
                        <a
                            class="cms-preview-link"
                            href="/d/presets/site-preview"
                            target="_blank"
                            rel="noopener"
                        >
                            预览网站
                            <StudioIcon name="external" size={14} />
                        </a>
                    )}
                    {sdk.context?.site && sdk.context.context.admin && (
                        <RouterLink
                            class="cms-publish-link"
                            to="/d/studio?section=release"
                        >
                            <StudioIcon name="release" size={16} />
                            发布更新
                        </RouterLink>
                    )}
                </>
            );
    },
});
export default DashboardSiteActions;
