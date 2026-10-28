import { defineComponent, onMounted, type PropType, ref } from 'vue';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/vue';
import type { JSX } from 'vue/jsx-runtime';
import { type DefaultComponentPropsType } from '@bcms/selfhosted-ui/components/default';
import type {
    ModalHandler,
    ModalHandlerOptions,
} from '@bcms/selfhosted-ui/services/modal';
import { Icon } from '@bcms/selfhosted-ui/components/icon';
import { Button } from '@bcms/selfhosted-ui/components/button';
import { useI18n } from 'vue-i18n';

export interface ModalDefaultPropsType<Input = unknown, Output = unknown>
    extends DefaultComponentPropsType {
    handler: ModalHandler<Input, Output>;
    selector: string;
}

export interface ModalDefaultPropsType<Input = unknown, Output = unknown>
    extends DefaultComponentPropsType {
    handler: ModalHandler<Input, Output>;
    title?: string;
    header?: () => JSX.Element;
    footer?: () => JSX.Element;
    doneText?: string;
    cancelText?: string;
}

export function getModalDefaultProps<Input = unknown, Output = unknown>(): {
    id: StringConstructor;
    style: StringConstructor;
    class: {
        type: StringConstructor;
        default: '';
    };
    cyTag: StringConstructor;
    handler: {
        type: PropType<ModalHandler<Input, Output>>;
        required: true;
    };
    title: StringConstructor;
    header: PropType<() => JSX.Element>;
    footer: PropType<() => JSX.Element>;
    doneText: StringConstructor;
    cancelText: StringConstructor;
} {
    return {
        id: String,
        style: String,
        class: {
            type: String,
            default: '',
        },
        cyTag: String,
        handler: {
            type: Object as PropType<ModalHandler<Input, Output>>,
            required: true,
        },
        title: String,
        header: Function as PropType<() => JSX.Element>,
        footer: Function as PropType<() => JSX.Element>,
        doneText: String,
        cancelText: String,
    };
}

export const ModalWrapper = defineComponent({
    props: getModalDefaultProps<any, any>(),
    setup(props, ctx) {
        const { t } = useI18n();
        const show = ref(false);
        let options: ModalHandlerOptions<any> | undefined = undefined;

        onMounted(() => {
            const handler = props.handler;
            handler.open = (opt) => {
                options = opt;
                show.value = true;
                handler._onOpen(options);
            };
            handler.close = (isDone, doneValue) => {
                show.value = false;
                if (isDone) {
                    if (options?.onDone) {
                        options.onDone(doneValue);
                    }
                } else {
                    if (options?.onCancel) {
                        options.onCancel();
                    }
                }
            };
        });

        function header() {
            return (
                <div class="cms-modal-header">
                    {props.header ? (
                        props.header()
                    ) : props.title ? (
                        <DialogTitle class="cms-modal-title">{props.title}</DialogTitle>
                    ) : (
                        ''
                    )}
                    <button
                        type="button"
                        aria-label="关闭弹窗"
                        class="cms-icon-button"
                        onClick={async () => {
                            if (await props.handler._onCancel()) {
                                await props.handler.close();
                            }
                        }}
                    >
                        <Icon src={'/close'} class={`w-6 h-6 fill-current`} />
                    </button>
                </div>
            );
        }

        function footer() {
            return (
                <div class="cms-modal-footer">
                    {props.footer ? (
                        props.footer()
                    ) : (
                        <div class="flex flex-wrap justify-end gap-2">
                            <Button
                                kind={`secondary`}
                                onClick={async () => {
                                    if (await props.handler._onCancel()) {
                                        props.handler.close();
                                    }
                                }}
                            >
                                {props.cancelText || t('common.cancel')}
                            </Button>
                            <Button
                                onClick={async () => {
                                    const [shouldContinue, data] =
                                        await props.handler._onDone();
                                    if (shouldContinue) {
                                        props.handler.close(true, data);
                                    }
                                }}
                            >
                                {props.doneText || t('common.done')}
                            </Button>
                        </div>
                    )}
                </div>
            );
        }

        async function cancel() {
            if (await props.handler._onCancel()) await props.handler.close();
        }
        return () => <Dialog open={show.value} onClose={cancel} class="cms-modal" aria-label={props.title || '编辑设置'}>
            <div class="cms-modal-backdrop" aria-hidden="true" />
            <div class="cms-modal-position"><DialogPanel class="cms-modal-panel">
                {header()}
                <div class="cms-modal-content">{ctx.slots.default?.()}</div>
                {footer()}
            </DialogPanel></div>
        </Dialog>;
    },
});
