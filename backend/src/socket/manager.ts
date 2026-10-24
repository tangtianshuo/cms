import { SocketManager as Connections } from '../_server/modules/socket';
import type { SocketEventName, SocketEventNamesAndTypes } from './events/main';
import { workspaceId } from '../workspaces/context';
import { refreshSocket } from './access';
export class SocketManager {
    static channelEmit<Name extends SocketEventName>(channels: string[], eventName: Name, eventData: SocketEventNamesAndTypes[Name], excludeChannels: string[] = []) {
        const sourceWorkspace = workspaceId();
        for (const conn of Object.values(Connections.conns)) {
            if (!conn.channels.some(channel => channels.includes(channel) && !excludeChannels.includes(channel))) continue;
            void (async () => {
                try {
                    const context = await refreshSocket(conn);
                    if (context.workspaceId !== sourceWorkspace) return;
                    if (['user', 'backup', 'api_key'].includes(eventName) && !context.instanceAdmin) return;
                    const data = eventData as { templateId?: string };
                    if (['entry', 'template'].includes(eventName) && !context.admin && !context.templatePermissions?.some(grant => grant._id === data?.templateId && grant.get)) return;
                    if (eventName === 'media' && context.mediaPermissions && !context.mediaPermissions.get) return;
                    conn.emit(eventName, eventData);
                } catch { conn.socket.close(1008, 'Access revoked'); }
            })();
        }
    }
}
