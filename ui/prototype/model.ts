export interface Item {
  id: string; kind: 'page' | 'product'; title: string; path: string;
  subtitle: string; body: string; image: string; price?: number;
  category?: string; navigation: boolean; updated: string;
}
export interface Site {
  id: string; name: string; domain: string; initials: string; theme: string;
  items: Item[]; live: Item[]; releases: { id: string; at: string; count: number; snapshot: Item[] }[];
}
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const fingerprint = (item: Item) => JSON.stringify({ ...item, updated: '' });
export const art = (name: string) => new URL(`./assets/${name}.svg`, import.meta.url).href;
export function seed(): Site[] {
  const items: Item[] = [
    { id: 'home', kind: 'page', title: '首页', path: '/', subtitle: '把日常，过成喜欢的样子。', body: '自然的材质，恰好的设计。我们寻找那些安静、耐用，让生活慢下来的好物。', image: art('interior'), navigation: true, updated: '今天 14:32' },
    { id: 'about', kind: 'page', title: '关于我们', path: '/about', subtitle: '让好设计，回到日常。', body: '从一把椅子、一只杯子开始，重新发现生活中细小而持久的美好。Atelier 与独立设计师合作，为每个日常寻找恰好的设计。', image: art('interior'), navigation: true, updated: '10 月 26 日' },
    { id: 'contact', kind: 'page', title: '联系我们', path: '/contact', subtitle: '期待与你聊聊。', body: '合作咨询：hello@atelier.example\n营业时间：周一至周五 09:00–18:00', image: art('vase'), navigation: true, updated: '10 月 25 日' },
    { id: 'chair', kind: 'product', title: '弧线 · 橡木休闲椅', path: '/products/oak-chair', subtitle: '一把可以陪伴很久的椅子', body: '精选实木，温润触感。以流畅的弧线承托每一次放松，让自然的纹理融入生活。', image: art('chair'), price: 1280, category: '家具', navigation: false, updated: '今天 11:08' },
    { id: 'vase', kind: 'product', title: '留白 · 手作陶瓶', path: '/products/ceramic-vase', subtitle: '盛放一枝花，也盛放片刻安静', body: '手工塑形，细腻的哑光釉面。每一件都保留着手作的独特质感。', image: art('vase'), price: 268, category: '生活器物', navigation: false, updated: '10 月 26 日' },
    { id: 'lamp', kind: 'product', title: '微光 · 纸艺台灯', path: '/products/paper-lamp', subtitle: '给夜晚一束温柔的光', body: '细密纸纹柔化光线，陪伴阅读、独处与日常。', image: art('lamp'), price: 459, category: '灯具', navigation: false, updated: '10 月 25 日' },
  ];
  const live = copy(items); live[0].subtitle = '让生活，回归自然。'; live[3].price = 1180;
  const other = copy(live).map(item => ({ ...item, subtitle: item.id === 'home' ? '日常之外，自有灵感。' : item.subtitle }));
  return [
    { id: 'atelier', name: 'Atelier 生活方式', domain: 'atelier.example', initials: 'A', theme: '自然留白', items, live, releases: [{ id: 'v1.3', at: '10 月 26 日 16:40', count: 6, snapshot: copy(live) }] },
    { id: 'forma', name: 'Forma 设计商店', domain: 'forma.example', initials: 'F', theme: '极简黑白', items: other, live: copy(other), releases: [{ id: 'v1.0', at: '10 月 25 日 10:20', count: 6, snapshot: copy(other) }] },
  ];
}
export function changes(site: Site) {
  return site.items.filter(item => { const live = site.live.find(v => v.id === item.id); return !live || fingerprint(live) !== fingerprint(item); });
}
export function issues(site: Site) {
  const problems: { id: string; field: string; text: string }[] = [];
  for (const item of site.items) {
    if (!item.title.trim()) problems.push({ id: item.id, field: 'title', text: `${item.kind === 'product' ? '商品' : '页面'}缺少标题` });
    if (!item.path.startsWith('/') || /[?#\s]/.test(item.path)) problems.push({ id: item.id, field: 'path', text: `“${item.title || '未命名'}”的访问路径不正确` });
    if (site.items.some(other => other.id !== item.id && other.path === item.path)) problems.push({ id: item.id, field: 'path', text: `“${item.title || '未命名'}”的访问路径与其他内容重复` });
    if (!item.subtitle.trim()) problems.push({ id: item.id, field: 'subtitle', text: `“${item.title || '未命名'}”缺少${item.kind === 'product' ? '商品简介' : '展示标题'}` });
    if (item.kind === 'product' && (!Number.isFinite(item.price) || Number(item.price) <= 0)) problems.push({ id: item.id, field: 'price', text: `“${item.title || '未命名商品'}”需要填写有效价格` });
  }
  return problems;
}
