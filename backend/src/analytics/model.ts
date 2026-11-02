export interface AnalyticsSummary { days: number; totals: { views: number; visitors: number }; pages: Array<{ path: string; views: number; visitors?: number }> }
