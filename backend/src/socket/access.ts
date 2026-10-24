import type { SocketConnection } from '../_server/modules/socket';
import { JWTManager, JWTError } from '../_server/modules/jwt';
import { Repo } from '../repo';
import { revalidateWorkspace } from '../workspaces/revalidate';
import { canWriteContent, runWithWorkspace, workspaceId, type WorkspaceContext } from '../workspaces/context';
import { useEntrySyncChannelHandler } from '../entry-sync/channel-handler';
import { validateContentNodes, validatePropValues } from '../workspaces/content-references';
interface SocketIdentity { token: string; context: WorkspaceContext; userId: string }
export async function socketIdentity(url = ''): Promise<SocketIdentity> {
    const query = new URL(url, 'http://socket.local').searchParams;
    const token = query.get('token') || '';
    const selected = { workspaceId: query.get('workspaceId') || query.get('x-bcms-workspace') || 'default', siteId: query.get('siteId') || query.get('x-bcms-site') || undefined };
    if (selected.workspaceId.length > 100 || (selected.siteId?.length || 0) > 100) throw new Error('Invalid socket scope');
    if (token.startsWith('apikey_')) {
        const [id, secret] = token.slice(7).split('.');
        const key = await Repo.apiKey.methods.findForAuthentication(id);
        if (!key || key.blocked || key.secret !== secret) throw new Error('Invalid socket API key');
        return { token, context: await revalidateWorkspace({ ...selected, actorId: key._id, apiKeyId: key._id }), userId: key.userId };
    }
    const jwt = JWTManager.get({ roles: ['ADMIN', 'USER', 'SUDO'], token });
    if (jwt instanceof JWTError) throw new Error('Invalid socket JWT');
    return { token, context: await revalidateWorkspace({ ...selected, actorId: jwt.payload.userId }), userId: jwt.payload.userId };
}
export async function refreshSocket(conn: SocketConnection): Promise<WorkspaceContext> {
    const identity = conn.metadata as SocketIdentity | undefined;
    if (!identity?.token) throw new Error('Socket is not authenticated');
    const url = new URL('http://socket.local');
    url.searchParams.set('token', identity.token); url.searchParams.set('workspaceId', identity.context.workspaceId);
    if (identity.context.siteId) url.searchParams.set('siteId', identity.context.siteId);
    const current = await socketIdentity(url.toString()); conn.metadata = current; return current.context;
}
export async function withSocketEvent<T>(conn: SocketConnection, name: string, data: any, action: () => Promise<T> | T) {
    const context = await refreshSocket(conn);
    return runWithWorkspace(context, async () => {
        if (!data || typeof data.entryId !== 'string') throw new Error('Missing entry scope');
        const entry = await Repo.entry.findById(data.entryId);
        if (!entry) throw new Error('Entry not found or not permitted');
        const readOnly = /(_open|_user_join|_user_leave|_focus|_mouse_move|_prose_cursor_update|_user_select_range|_content_req|_y_sync_req)$/.test(name);
        if (!readOnly && !canWriteContent('Entry', entry, 'put')) throw new Error('Entry synchronization is read only');
        if (data.value?._id && name === 'entry_sync_media_update' && !await Repo.media.findById(data.value._id)) throw new Error('Media not permitted');
        if (data.value?.tid && name === 'entry_sync_entry_pointer_update') {
            const referenced = await Repo.entry.findById(data.value.eid);
            if (!referenced || referenced.templateId !== data.value.tid) throw new Error('Entry reference not permitted');
        }
        if (data.data) {
            if (data.data._id !== entry._id || data.data.templateId !== entry.templateId || (data.data.workspaceId && data.data.workspaceId !== context.workspaceId)) throw new Error('Invalid synchronized entry');
            const template = await Repo.template.findById(entry.templateId);
            if (!template) throw new Error('Template not permitted');
            for (const meta of data.data.meta || []) await validatePropValues(template.props, meta.props);
            for (const content of data.data.content || []) await validateContentNodes(content.nodes);
        }
        if (name !== 'entry_sync_y_sync_res' && name !== 'entry_sync_content_res') data.sourceConnId = conn.id;
        if ('userId' in data) data.userId = conn.channels[0];
        return action();
    });
}
export async function emitEntrySync(conn: SocketConnection, name: string, data: any, sourceWorkspace = workspaceId()) {
    try {
        const context = await refreshSocket(conn);
        if (context.workspaceId !== sourceWorkspace) return;
        await runWithWorkspace(context, async () => {
            if (!useEntrySyncChannelHandler().getConnection(data.entryId, conn.id, conn.channels[0])) return;
            if (await Repo.entry.findById(data.entryId)) conn.emit(name, data);
        });
    } catch { conn.socket.close(1008, 'Access revoked'); }
}
