export type PublishStatus = 'draft' | 'checking' | 'publishing' | 'ready' | 'failed' | 'rolled-back';

export function normalizePublishStatus(status: unknown, operation: 'publish' | 'rollback' = 'publish'): PublishStatus {
    if (operation === 'rollback' && status === 'ready') return 'rolled-back';
    if (status === 'pending') return 'publishing';
    if (status === 'ready') return 'ready';
    if (status === 'failed') return 'failed';
    return 'draft';
}
