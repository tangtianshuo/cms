import * as uuid from 'uuid';
import { defineComponent, ref, onUnmounted } from 'vue';
import type {
    NotificationMessage,
    NotificationMessageType,
} from '@bcms/selfhosted-ui/services/notification';
import { Icon } from '@bcms/selfhosted-ui/components/icon';

const component = defineComponent({
    setup() {
        const notification = window.bcms.notification;
        const timeout = 8000;
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const notifUnreg = notification.register((type, content) => {
            const message: NotificationMessage = {
                id: uuid.v4(),
                type,
                content,
            };
            if (messages.value.find((e) => e.content === message.content)) {
                return;
            }
            if (type !== 'error' && type !== 'warning') {
                const timer = setTimeout(() => {
                    messages.value = messages.value.filter(
                        (e) => e.id !== message.id,
                    );
                    timers.delete(timer);
                }, timeout);
                timers.add(timer);
            }
            messages.value = [...messages.value, message];
        });
        const messages = ref<NotificationMessage[]>([]);

        function messageTypeClass(type: NotificationMessageType) {
            switch (type) {
                case 'error': {
                    return 'bg-error';
                }
                case 'success': {
                    return 'bg-success';
                }
                case 'warning': {
                    return 'bg-warning';
                }
            }
        }

        onUnmounted(() => {
            notifUnreg();
            timers.forEach(clearTimeout);
        });

        function getTypeIcon(type: NotificationMessageType) {
            switch (type) {
                case 'error': {
                    return (
                        <Icon
                            src="/alert-triangle"
                            class="w-6 h-6 flex-shrink-0 text-red fill-current"
                        />
                    );
                }
                case 'success': {
                    return (
                        <Icon
                            src="/success"
                            class="w-6 h-6 flex-shrink-0 text-green fill-current"
                        />
                    );
                }
                case 'warning': {
                    return (
                        <Icon
                            src="/bell"
                            class="w-6 h-6 flex-shrink-0 text-yellow fill-current stroke-current"
                        />
                    );
                }
            }
        }

        return () => {
            return (
                <div class="fixed z-[10000000] w-[90vw] top-[5px] left-1/2 -translate-x-1/2 max-h-[calc(100vh-10px)] overflow-y-auto md:min-w-[50vw] md:max-w-[700px] ">
                    {messages.value.map((message) => {
                        return (
                            <div
                                key={message.id}
                                class="grid grid-cols-1 gap-2.5"
                            >
                                <div
                                    id={message.id}
                                    role={
                                        message.type === 'error' ||
                                        message.type === 'warning'
                                            ? 'alert'
                                            : 'status'
                                    }
                                    class={`cms-notification w-full flex items-center py-1 pl-6 pr-3 rounded-lg min-h-[48px] mb-2.5 ${messageTypeClass(
                                        message.type,
                                    )}`}
                                >
                                    {getTypeIcon(message.type)}
                                    <p class="text-sm leading-relaxed break-words whitespace-pre-wrap ml-4.5 text-dark">
                                        {message.content}
                                    </p>
                                    <button
                                        type="button"
                                        aria-label="关闭提示"
                                        class="group p-3 ml-auto flex"
                                        onClick={() => {
                                            messages.value =
                                                messages.value.filter(
                                                    (e) => e.id !== message.id,
                                                );
                                        }}
                                    >
                                        <Icon
                                            src="/close"
                                            class="w-6 h-6 flex-shrink-0 text-dark fill-current stroke-current m-auto transition-colors duration-300 group-scope-hover:text-red group-scope-focus-visible:text-red"
                                        />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        };
    },
});
export default component;
