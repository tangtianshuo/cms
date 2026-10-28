export const studioSections = [
    { key: 'overview', label: '工作台', eyebrow: 'WORKSPACE OVERVIEW', description: '管理内容，掌握网站的每一次更新。', icon: 'overview' },
    { key: 'products', label: '商品与内容', eyebrow: 'CONTENT LIBRARY', description: '管理商品与网站资料，保存草稿后预览确认。', icon: 'products' },
    { key: 'pages', label: '网站页面', eyebrow: 'WEBSITE PAGES', description: '组织页面内容、导航与访问路径。', icon: 'pages' },
    { key: 'media', label: '素材库', eyebrow: 'MEDIA LIBRARY', description: '上传、管理并复用网站素材。', icon: 'media' },
    { key: 'settings', label: '网站设置', eyebrow: 'SITE SETTINGS', description: '设置网站名称与品牌外观，保存后统一发布。', icon: 'settings' },
    { key: 'release', label: '发布中心', eyebrow: 'PUBLISH CENTER', description: '检查已保存的修改，确认后更新网站。', icon: 'release' },
] as const;
export type StudioSection = typeof studioSections[number]['key'];
export function studioSection(value: unknown): StudioSection {
    if (value === 'content') return 'products';
    return studioSections.some(item => item.key === value) ? value as StudioSection : 'overview';
}
export function isDashboardLinkActive(route: { path: string; query: Record<string, unknown> }, href: string): boolean {
    const [path, query = ''] = href.split('?');
    if (path === '/d/studio') return route.path === path && studioSection(route.query.section) === studioSection(new URLSearchParams(query).get('section'));
    return route.path === path || route.path.startsWith(`${path}/`);
}
