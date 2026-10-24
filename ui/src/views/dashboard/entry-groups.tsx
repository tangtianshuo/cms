import { defineComponent } from 'vue';
import { EntryGroupManager } from '@bcms/selfhosted-ui/components/workspace/entry-groups';
export default defineComponent({
    setup: () => () =>
        (
            <div class="max-w-5xl">
                <EntryGroupManager />
            </div>
        ),
});
