import { defineComponent, onMounted, type PropType, ref } from 'vue';
import {
    InputProps,
    InputWrapper,
} from '@bcms/selfhosted-ui/components/inputs/_wrapper';
import type { EntrySync } from '@bcms/selfhosted-ui/services/entry-sync';
import type { UnsubscribeFns } from '@bcms/selfhosted-ui/util/sub';
import {
    patienceDiff,
    patienceDiffMerge,
    patienceDiffToSocketEvent,
} from '@bcms/selfhosted-ui/util/patience-diff';

export const TextInput = defineComponent({
    inheritAttrs: true,
    props: {
        ...InputProps,
        value: String,
        focus: Boolean,
        placeholder: String,
        type: {
            type: String as PropType<'text' | 'email'>,
            default: 'text',
        },
        disabled: Boolean,
        entrySync: Object as PropType<EntrySync>,
    },
    emits: {
        enter: (_event: Event) => {
            return true;
        },
        input: (_value: string, _event?: Event) => {
            return true;
        },
    },
    setup(props, ctx) {
        const inputRef = ref<HTMLInputElement | null>(null);
        const unsubs: UnsubscribeFns = [];

        function inputHandler(event: Event) {
            const element = event.target as HTMLInputElement;
            if (!element) {
                return;
            }
            if (props.entrySync) {
                const currValue = props.value || '';
                const changes = patienceDiffToSocketEvent(
                    patienceDiff(currValue.split(''), element.value.split(''))
                        .lines,
                );
                props.entrySync.emitStringUpdate({
                    propPath: props.id || '__none',
                    changes,
                });
            }
            ctx.emit('input', element.value, event);
        }

        onMounted(async () => {
            if (props.entrySync) {
                unsubs.push(
                    props.entrySync.onStringUpdate(
                        props.id || '__none',
                        async (data) => {
                            if (data.changes) {
                                const merge = patienceDiffMerge(
                                    data.changes,
                                    props.value || '',
                                );
                                ctx.emit('input', merge);
                            }
                        },
                    ),
                );
            }
            if (props.focus && inputRef.value) {
                inputRef.value.focus();
            }
        });

        return () => {
            return (
                <InputWrapper
                    id={props.id}
                    class={props.class}
                    label={props.label}
                    description={props.description}
                    required={props.required}
                    error={props.error}
                >
                    <input
                        data-cms-control="true"
                        id={props.id || (typeof props.label === "string" ? props.label : undefined)}
                        aria-invalid={Boolean(props.error) || undefined}
                        aria-describedby={props.error ? `${props.id || props.label}-error` : undefined}
                        required={props.required}
                        ref={inputRef}
                        type={props.type}
                        class={`cms-text-control ${props.error ? "is-error" : ""}`}
                        placeholder={props.placeholder}
                        value={props.value}
                        disabled={props.disabled}
                        onChange={inputHandler}
                        onKeyup={(event) => {
                            inputHandler(event);
                            if (event.key === 'Enter') {
                                ctx.emit('enter', event);
                            }
                        }}
                    />
                </InputWrapper>
            );
        };
    },
});
