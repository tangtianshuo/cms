import { defineComponent, ref } from 'vue';
import {
    InputProps,
    InputWrapper,
} from '@bcms/selfhosted-ui/components/inputs/_wrapper';
import { Icon } from '@bcms/selfhosted-ui/components/icon';

export const PasswordInput = defineComponent({
    props: {
        ...InputProps,
        value: String,
        placeholder: String,
        disabled: Boolean,
        readonly: {
            type: Boolean,
            default: false,
        },
    },
    emits: {
        input: (value: string) => {
            return value;
        },
        enter: (_?: unknown) => {
            return _;
        },
        'update:modelValue': (value: string) => {
            return value;
        },
    },
    setup(props, ctx) {
        const showRef = ref(false);
        function inputHandler(event: Event) {
            const element = event.target as HTMLInputElement;
            if (!element) return;
            ctx.emit('update:modelValue', element.value);
            ctx.emit('input', element.value);
        }
        return () => {
            return (
                <InputWrapper
                    id={props.id}
                    class={props.class}
                    label={props.label}
                    description={props.description}
                    error={props.error}
                >
                    <div
                        class={`cms-password-field flex ${
                            props.error
                                ? 'border border-red hover:border-red focus-within:border-red'
                                : ''
                        }`}
                    >
                        <input
                        data-cms-control="true"
                            aria-label={typeof props.label === "string" ? props.label : undefined}
                            id={props.id}
                            class={`cms-text-control ${props.error ? "is-error" : ""}`}
                            placeholder={props.placeholder}
                            value={props.value}
                            type={showRef.value ? 'text' : 'password'}
                            disabled={props.disabled}
                            onChange={inputHandler}
                            onKeyup={(event) => {
                                inputHandler(event);
                                if (event.key === 'Enter') {
                                    ctx.emit('enter');
                                }
                            }}
                            readonly={props.readonly}
                        />
                        <button
                            aria-label={showRef.value ? "隐藏密码" : "显示密码"}
                            class={`cms-password-toggle absolute top-3 ${
                                props.error ? 'right-10.5' : 'right-3'
                            }`}
                            type="button"
                            disabled={props.disabled}
                            onClick={() => {
                                showRef.value = !showRef.value;
                            }}
                        >
                            {showRef.value ? (
                                <Icon
                                    src="/eye/show"
                                    class="w-5 h-5 m-auto fill-current text-grey"
                                />
                            ) : (
                                <Icon
                                    src="/eye/hide"
                                    class="w-5 h-5 m-auto stroke-current text-grey"
                                />
                            )}
                        </button>
                    </div>
                </InputWrapper>
            );
        };
    },
});
