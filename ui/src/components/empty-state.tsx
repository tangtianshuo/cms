import { defineComponent, type PropType } from 'vue';
import { Button } from './button';
import { DefaultComponentProps } from './default';
import { StudioIcon } from './studio/icon';
import { useI18n } from 'vue-i18n';
export const EmptyState = defineComponent({
    props: {
        ...DefaultComponentProps,
        maxWidth: { type: String, default: '100%' }, maxHeight: { type: String, default: '100%' },
        src: { type: String, required: true }, alt: String, title: String, subtitle: String,
        clickHandler: Function as PropType<(_: MouseEvent) => any>, ctaText: String,
    },
    setup(props) {
        const { t } = useI18n();
        return () => <section class="cms-empty-state"><span class="cms-empty-symbol" aria-hidden="true"><StudioIcon name={props.src.includes('media') ? 'media' : 'pages'} size={28} /></span>{props.title && <h1>{props.title}</h1>}<p>{props.subtitle || t('common.empty')}</p>{props.clickHandler && <Button onClick={props.clickHandler}>{props.ctaText}</Button>}</section>;
    },
});
