import { defineComponent, nextTick, onMounted, ref, watch, type PropType } from 'vue';

export interface PageBlueprintOption { key: string; title: string; modelKey: string; path?: string }

export const PageCreateWizard = defineComponent({
    name: 'PageCreateWizard',
    props: { blueprints: { type: Array as PropType<PageBlueprintOption[]>, required: true }, open: Boolean, disabled: Boolean },
    emits: ['create', 'close'],
    setup(props, { emit }) {
        const dialog = ref<HTMLDialogElement>();
        onMounted(() => dialog.value?.addEventListener('cancel', () => emit('close')));
        watch(() => props.open, async open => {
            await nextTick();
            if (open && !dialog.value?.open) dialog.value?.showModal();
            else if (!open && dialog.value?.open) dialog.value.close();
        }, { immediate: true, flush: 'post' });
        return () => <dialog ref={dialog} class="studio-page-create-wizard" aria-modal="true" aria-label="新增页面向导">
            <div class="studio-page-create-heading"><div><h2>新增网站页面</h2><p class="studio-help">选择页面样式，接着在内容工作区填写正文和访问路径。</p></div><button type="button" class="studio-dialog-close" aria-label="关闭新增页面向导" onClick={() => emit('close')}>×</button></div>
            <div class="studio-page-blueprints">{props.blueprints.map(blueprint => <button key={blueprint.key} type="button" disabled={props.disabled} onClick={() => emit('create', blueprint)}><strong>{blueprint.title}</strong><span>{blueprint.path || '自定义路径'}</span></button>)}</div>
        </dialog>;
    },
});
