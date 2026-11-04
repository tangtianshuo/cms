export type AnalyticsState = 'loading' | 'unconfigured' | 'error' | 'ready';

export function analyticsViewState(input: {
    loading: boolean;
    error: string;
    configured?: boolean;
    hasData: boolean;
}): AnalyticsState {
    if (input.loading) return 'loading';
    if (input.error) return 'error';
    if (input.configured === false) return 'unconfigured';
    return input.hasData ? 'ready' : 'error';
}

export function analyticsMetric(value: unknown, state: AnalyticsState): string {
    return state === 'ready' && typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}
