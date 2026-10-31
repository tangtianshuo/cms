import type { Sdk } from '../../sdk/main';

export interface SiteChoiceGroup {
    _id: string;
    name: string;
    sites: Array<{ _id: string; name: string }>;
    unavailable: boolean;
}
export async function loadSiteChoices(sdk: Pick<Sdk, 'send'>): Promise<SiteChoiceGroup[]> {
    const { items } = await sdk.send<{ items: Array<{ _id: string; name: string }> }>({
        url: '/api/v4/workspaces', selectorOverride: { workspaceId: 'default' },
    });
    const lists = await Promise.allSettled(items.map(workspace => sdk.send<{ items: Array<{ _id: string; name: string }> }>({
        url: '/api/v4/workspaces/current/sites', selectorOverride: { workspaceId: workspace._id },
    })));
    return items.map((workspace, index) => {
        const result = lists[index];
        return { ...workspace, sites: result.status === 'fulfilled' ? result.value.items : [], unavailable: result.status === 'rejected' };
    });
}
export async function selectSiteAfterNavigation(navigate: () => Promise<unknown>, select: () => Promise<unknown>): Promise<boolean> {
    if (await navigate()) return false;
    await select();
    return true;
}
