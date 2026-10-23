import { randomUUID } from 'node:crypto';
import { Repo } from '../repo';
import { DEFAULT_WORKSPACE, workspaceContext, workspaceId } from './context';

export class WorkspaceLifecycleError extends Error {
    readonly status = 409;
}

/**
 * Hold a durable creation reservation until every write has acknowledged success.
 * A rejection retains the reservation: a timed-out database command may still
 * commit. Recovery requires stopping/fencing that writer before acknowledgement.
 * The default workspace cannot be deleted and does not need a reservation.
 */
export async function withWorkspaceCreation<T>(
    resource: { kind: string; resourceId: string },
    action: () => Promise<T>,
): Promise<T> {
    const id = workspaceId();
    if (id === DEFAULT_WORKSPACE) return action();
    const reservation = {
        id: randomUUID(),
        ...resource,
        actorId: workspaceContext()?.actorId || '__internal',
        createdAt: Date.now(),
    };
    if (!(await Repo.workspace.methods.reserveCreation(id, reservation))) {
        throw new WorkspaceLifecycleError(
            'Workspace no longer exists; refresh before creating resources',
        );
    }
    // Do not release in finally. Failed/uncertain persistence must retain the
    // durable guard until an operator can establish that the writer is stopped.
    const result = await action();
    try {
        await Repo.workspace.methods.completeCreation(id, reservation.id);
    } catch (error) {
        // Acknowledgement failure cannot turn an acknowledged insertion into a
        // misleading creation failure. The retained reservation blocks deletion.
        console.error(
            'Workspace creation acknowledgement deferred; durable reservation retained',
            error,
        );
    }
    return result;
}
