import { defineComponent, type PropType } from 'vue';

export interface PageBlueprintOption { key: string; title: string; modelKey: string; path?: string }

export const PageCreateWizard = defineComponent({
    name: 'PageCreateWizard',
    props: { blueprints: { type: Array as PropType<PageBlueprintOption[]>, required: true }, open: Boolean, disabled: Boolean },
    emits: ['create', 'close'],
    setup(props, { emit }) {
        return () => <dialog open={props.open} class="studio-page-create-wizard" aria-modal="true" aria-label="新增页面向导">
            <div class="studio-page-create-heading"><div><h2>新增网站页面</h2><p class="studio-help">选择模板声明的页面蓝图，填写内容后一次性创建页面和绑定。</p></div><button type="button" class="studio-dialog-close" aria-label="关闭新增页面向导" onClick={() => emit('close')}>×</button></div>
            <div class="studio-page-blueprints">{props.blueprints.map(blueprint => <button key={blueprint.key} type="button" disabled={props.disabled} onClick={() => emit('create', blueprint)}><strong>{blueprint.title}</strong><span>{blueprint.path || '自定义路径'}</span></button>)}</div>
        </dialog>;
    },
});
