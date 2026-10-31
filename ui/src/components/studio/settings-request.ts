import type { NavigationNode, SiteOperations } from '../../sdk/handlers/studio';

/** Keep editor-only fields out of the strict API theme object. */
export function settingsRequest(expectedUpdatedAt: number, settings: { name: string; background: string; foreground: string; accent: string; muted: string; navigation: NavigationNode[]; operations: SiteOperations }) {
    const { name, background, foreground, accent, muted, navigation, operations } = settings;
    return { expectedUpdatedAt, name, theme: { background, foreground, accent, muted }, navigation, operations };
}
