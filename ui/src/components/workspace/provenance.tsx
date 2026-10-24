import { defineComponent, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MongoDBEntry } from '@bcms/selfhosted-backend/_server/modules/mongodb/entry';

export const CopyProvenance = defineComponent({
    props: { value: { type: Object as PropType<MongoDBEntry['provenance']> } },
    setup(props) {
        const { t } = useI18n();
        return () =>
            props.value ? (
                <p class="mt-3 break-all border-l-2 border-gray pl-3 text-xs opacity-70">
                    {t('shares.provenance', {
                        workspace: props.value.ownerWorkspaceId,
                        resource: props.value.resourceId,
                        version: props.value.version,
                    })}
                </p>
            ) : null;
    },
});
