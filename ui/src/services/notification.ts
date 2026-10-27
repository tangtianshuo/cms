import * as uuid from 'uuid';
import type { JSX } from 'vue/jsx-runtime';
import { userErrorMessage } from '../util/user-message';

export interface NotificationMessage {
    id: string;
    type: NotificationMessageType;
    content: string | (() => JSX.Element);
}

export type NotificationMessageType = 'info' | 'error' | 'success' | 'warning';

export class NotificationService {
    private handlers: Array<{
        id: string;
        handler(type: NotificationMessageType, content: string): void;
    }> = [];

    register(
        handler: (type: NotificationMessageType, content: string) => void,
    ): () => void {
        const id = uuid.v4();
        this.handlers.push({ id, handler });
        return () => {
            for (let i = 0; i < this.handlers.length; i++) {
                if (this.handlers[i].id === id) {
                    this.handlers.splice(i, 1);
                    break;
                }
            }
        };
    }

    info(content: string): void {
        this.handlers.forEach((e) => {
            e.handler('info', content);
        });
    }

    warning(content: unknown): void {
        this.push('warning', userErrorMessage(content));
    }

    success(content: string): void {
        this.handlers.forEach((e) => {
            e.handler('success', content);
        });
    }

    error(content: unknown): void {
        this.push('error', userErrorMessage(content));
    }

    push(type: NotificationMessageType, content: string): void {
        const message =
            type === 'error' || type === 'warning'
                ? userErrorMessage(content)
                : content;
        this.handlers.forEach((e) => {
            e.handler(type, message);
        });
    }
}

let service: NotificationService | null = null;

export function createNotificationService(): NotificationService {
    service = new NotificationService();
    return service;
}

export function useNotificationService() {
    if (!service) {
        throw Error('Notification service not initialized');
    }
    return service;
}
