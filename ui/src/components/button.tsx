import { defineComponent, type PropType, type Ref } from 'vue';
import { DefaultComponentProps } from './default';

export const Button = defineComponent({
    props: {
        ...DefaultComponentProps,
        btnRef: Object as PropType<Ref>,
        kind: { type: String as PropType<'primary' | 'secondary' | 'alternate' | 'ghost' | 'danger'>, default: 'primary' },
        disabled: Boolean,
        type: { type: String as PropType<'button' | 'submit' | 'reset'>, default: 'button' },
        size: String as PropType<'m' | 's'>,
        href: String,
        newTab: Boolean,
    },
    emits: { click: (_event: MouseEvent) => true },
    setup(props, ctx) {
        return () => {
            const Tag = props.href ? 'a' : 'button';
            return <Tag ref={props.btnRef} class={['bcmsButton', `bcmsButton_${props.kind}`, props.size ? `bcmsButton_${props.size}` : '', props.class]} v-cy={props.cyTag} style={props.style} type={props.href ? undefined : props.type} disabled={props.href ? undefined : props.disabled} aria-disabled={props.disabled || undefined} onClick={event => { if (props.disabled) { event.preventDefault(); return; } ctx.emit('click', event); }} href={props.href} target={props.newTab ? '_blank' : undefined} rel={props.newTab ? 'noopener noreferrer' : undefined}><span>{ctx.slots.default?.()}</span></Tag>;
        };
    },
});
