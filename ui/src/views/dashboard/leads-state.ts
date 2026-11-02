export function buildLeadsQuery(status = '', search = ''): string {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (search.trim()) query.set('search', search.trim());
    return query.toString();
}

export function leadUpdatePayload(patch: { status?: string; assignedTo?: string; notes?: string }) {
    return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

export function leadViewState(input: { loading: boolean; error: string; count: number }): 'loading' | 'error' | 'empty' | 'ready' {
    if (input.loading) return 'loading';
    if (input.error) return 'error';
    return input.count ? 'ready' : 'empty';
}
