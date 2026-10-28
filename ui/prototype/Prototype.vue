<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { art, changes, copy, fingerprint, issues, seed, type Item, type Site } from './model';

const storageKey = 'cms-studio-prototype-v1';
function load(): Site[] { try { const data = JSON.parse(localStorage.getItem(storageKey) || 'null'); return Array.isArray(data) && data.length && data.every(s => Array.isArray(s.items) && Array.isArray(s.live) && Array.isArray(s.releases)) ? data : seed(); } catch { return seed(); } }
const sites = ref<Site[]>(load());
const selected = ref(sites.value[0].id);
const site = computed(() => sites.value.find(s => s.id === selected.value)!);
const section = ref('overview');
const editor = ref<Item | null>(null);
const original = ref('');
const unsaved = computed(() => !!editor.value && fingerprint(editor.value) !== original.value);
const changed = computed(() => changes(site.value));
const problems = computed(() => issues(site.value));
const modal = ref('');
const siteMenu = ref(false);
const mobileNav = ref(false);
const toast = ref('');
const search = ref('');
const filter = ref('all');
const settingsTab = ref('brand');
const previewItem = ref('home');
const previewMode = ref('draft');
const viewport = ref('desktop');
const uploadInput = ref<HTMLInputElement>();
const publishing = ref(false);
const publishPhase = ref(0);
const checkState = ref('idle');
const checkedSnapshot = ref('');
const newName = ref('');
const newTheme = ref('自然留白');
const wizardStep = ref(1);
const formError = ref('');
const brandName = ref(site.value.name);
const brandDomain = ref(site.value.domain);
const extraAssets = ref<string[]>([]);
const assets = computed(() => [art('interior'), art('chair'), art('vase'), art('lamp'), ...extraAssets.value]);
const assetNames = ['午后 · 家的角落', '弧线 · 橡木休闲椅', '留白 · 手作陶瓶', '微光 · 纸艺台灯'];
const nav = [{ id: 'overview', name: '工作台', icon: 'grid' }, { id: 'products', name: '商品', icon: 'bag' }, { id: 'pages', name: '网站页面', icon: 'page' }, { id: 'media', name: '素材', icon: 'image' }, { id: 'settings', name: '网站设置', icon: 'settings' }];
const sectionName = computed(() => nav.find(n => n.id === section.value)?.name || '发布中心');
const visibleItems = computed(() => site.value.items.filter(i => i.kind === (section.value === 'products' ? 'product' : 'page')).filter(i => i.title.toLowerCase().includes(search.value.toLowerCase())).filter(i => filter.value === 'all' || changed.value.some(c => c.id === i.id)));
const previewItems = computed(() => previewMode.value === 'live' ? site.value.live : site.value.items);
const activePreview = computed(() => {
  if (previewMode.value === 'draft' && editor.value && editor.value.id === previewItem.value) return editor.value;
  return previewItems.value.find(i => i.id === previewItem.value);
});
const anyLive = computed(() => !!site.value.releases.length);
const savedState = computed(() => editor.value && site.value.items.some(i => i.id === editor.value!.id) ? '草稿已保存' : '新内容');
const setupTasks = computed(() => [
  { name: '选择网站模板', detail: site.value.theme, done: true, action: () => go('settings') },
  { name: '完善品牌信息', detail: '网站名称、品牌标识与联系方式', done: !site.value.name.startsWith('新站点'), action: () => { settingsTab.value = 'brand'; go('settings'); } },
  { name: '修改首页内容', detail: '替换标题、介绍和主视觉', done: !!site.value.items.find(i => i.id === 'home')?.body, action: () => edit(site.value.items.find(i => i.id === 'home')!) },
  { name: '添加第一件商品', detail: '填写名称、价格并选择图片', done: site.value.items.some(i => i.kind === 'product'), action: () => createItem('product') },
  { name: '预览并发布网站', detail: '检查内容，让你的新网站上线', done: anyLive.value, action: () => go('publish') },
]);
const completedTasks = computed(() => setupTasks.value.filter(t => t.done).length);
let toastTimer: ReturnType<typeof setTimeout>;
function notify(text: string) { toast.value = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 3500); }
let persistWarning = false;
watch(sites, () => { try { localStorage.setItem(storageKey, JSON.stringify(sites.value)); } catch { if (!persistWarning) { persistWarning = true; notify('浏览器存储空间不足，本次修改仅保留在当前页面。'); } } }, { deep: true });
watch(selected, () => { brandName.value = site.value.name; brandDomain.value = site.value.domain; });
let returnFocus: HTMLElement | null = null;
watch(modal, async (value, previous) => {
  if (value && !previous) returnFocus = document.activeElement as HTMLElement;
  document.body.style.overflow = value ? 'hidden' : '';
  await nextTick();
  if (value) {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) {
      dialog.tabIndex = -1;
      (dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)') || dialog).focus();
    }
  } else if (previous) {
    if (returnFocus?.isConnected) returnFocus.focus();
    else document.getElementById('main-content')?.focus();
  }
});
let pending: (() => void) | null = null;
function guarded(action: () => void) { if (unsaved.value) { pending = action; modal.value = 'leave'; } else action(); }
function resolveLeave(save: boolean) {
  if (save && !saveDraft(true)) { modal.value = ''; pending = null; return; }
  if (!save) original.value = editor.value ? fingerprint(editor.value) : '';
  const action = pending; pending = null; action?.();
}
function scrollTop() { nextTick(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })); }
function go(target: string) { guarded(() => { section.value = target; editor.value = null; modal.value = ''; search.value = ''; filter.value = 'all'; mobileNav.value = false; location.hash = target; scrollTop(); }); }
function switchSite(id: string) { guarded(() => { selected.value = id; checkState.value = 'idle'; editor.value = null; section.value = 'overview'; siteMenu.value = false; mobileNav.value = false; modal.value = ''; scrollTop(); notify(`已切换至 ${site.value.name}`); }); }
function edit(item: Item, field = '') { guarded(() => {
  editor.value = copy(item); original.value = fingerprint(item); section.value = item.kind === 'product' ? 'products' : 'pages'; modal.value = ''; formError.value = ''; location.hash = `edit/${item.id}`;
  scrollTop(); mobileNav.value = false;
  if (field) nextTick(() => document.getElementById(`field-${field}`)?.focus());
}); }
function createItem(kind: Item['kind']) { guarded(() => {
  const item: Item = { id: crypto.randomUUID(), kind, title: '', path: kind === 'product' ? '/products/' : '/pages/', subtitle: '', body: '', image: art(kind === 'product' ? 'chair' : 'interior'), navigation: kind === 'page', updated: '', ...(kind === 'product' ? { price: 0, category: '生活器物' } : {}) };
  editor.value = item; original.value = fingerprint(item); section.value = kind === 'product' ? 'products' : 'pages'; formError.value = ''; modal.value = ''; scrollTop(); mobileNav.value = false;
}); }
function suggestPath() {
  if (!editor.value || site.value.items.some(i => i.id === editor.value!.id)) return;
  const slug = editor.value.title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  editor.value.path = `${editor.value.kind === 'product' ? '/products' : '/pages'}/${slug}`;
}
function saveDraft(quiet = false) {
  if (!editor.value) return false;
  if (!editor.value.title.trim()) { formError.value = '请先填写标题，再保存草稿。'; nextTick(() => document.getElementById('field-title')?.focus()); return false; }
  const item = copy(editor.value); item.title = item.title.trim(); item.updated = '刚刚';
  const index = site.value.items.findIndex(i => i.id === item.id);
  if (index === -1) site.value.items.push(item); else site.value.items[index] = item;
  editor.value = copy(item); original.value = fingerprint(item); formError.value = ''; checkState.value = 'idle';
  if (!quiet) notify('草稿已保存，发布后将在网站生效。'); return true;
}
function preview(id = 'home', mode = 'draft') { previewItem.value = id; previewMode.value = mode; viewport.value = 'desktop'; modal.value = 'preview'; }
function startPublish() { guarded(() => { editor.value = null; section.value = 'publish'; modal.value = ''; checkState.value = 'idle'; location.hash = 'publish'; scrollTop(); nextTick(runCheck); }); }
async function runCheck() { if (checkState.value === 'checking' || publishing.value) return; checkState.value = 'checking'; await new Promise(r => setTimeout(r, 650)); checkedSnapshot.value = JSON.stringify(site.value.items); checkState.value = problems.value.length ? 'issues' : 'ready'; }
async function publish() {
  if (publishing.value || checkState.value !== 'ready' || problems.value.length || !changed.value.length) return;
  if (checkedSnapshot.value !== JSON.stringify(site.value.items)) { checkState.value = 'idle'; notify('内容有新修改，请重新检查。'); return; }
  modal.value = 'publishing'; publishing.value = true; publishPhase.value = 0;
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 650)); publishPhase.value = i + 1; }
  site.value.live = copy(site.value.items);
  site.value.releases.unshift({ id: `v1.${site.value.releases.length + 3}`, at: '刚刚', count: site.value.items.length, snapshot: copy(site.value.live) });
  publishing.value = false; modal.value = 'published'; checkState.value = 'idle';
}
function createSite() {
  if (!newName.value.trim()) { formError.value = '请填写站点名称'; return; }
  const home: Item = { id: 'home', kind: 'page', title: '首页', path: '/', subtitle: '让美好，在这里发生。', body: '', image: art('interior'), navigation: true, updated: '刚刚' };
  const next: Site = { id: crypto.randomUUID(), name: newName.value.trim(), domain: '', initials: newName.value.trim().slice(0, 1).toUpperCase(), theme: newTheme.value, items: [home], live: [], releases: [] };
  sites.value.push(next); selected.value = next.id; checkState.value = 'idle'; editor.value = null; section.value = 'overview'; modal.value = ''; siteMenu.value = false; mobileNav.value = false; scrollTop(); notify('站点已创建，首页和内容结构已准备就绪。');
}
function openNewSite() { guarded(() => { newName.value = ''; wizardStep.value = 1; formError.value = ''; modal.value = 'new-site'; siteMenu.value = false; }); }
function saveBrand() { if (!brandName.value.trim()) { notify('请填写网站名称'); return; } site.value.name = brandName.value.trim(); site.value.domain = brandDomain.value.trim(); site.value.initials = site.value.name.slice(0, 1).toUpperCase(); notify('站点设置已保存。此处域名仅用于原型演示。'); }
function selectAsset(url: string) { if (editor.value) { editor.value.image = url; modal.value = ''; notify('图片已替换，请保存草稿。'); } }
async function upload(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { notify('请选择 2MB 以内的 PNG、JPG 或 WebP 图片。'); return; } const reader = new FileReader(); reader.onload = () => { extraAssets.value.push(String(reader.result)); notify('图片已添加至本次演示素材。'); }; reader.readAsDataURL(file); }
function reset() { sites.value = seed(); selected.value = sites.value[0].id; editor.value = null; section.value = 'overview'; modal.value = ''; checkState.value = 'idle'; notify('演示数据已恢复。'); }
function escape(event: KeyboardEvent) {
  if (event.key === 'Tab' && modal.value) {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const targets = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []).filter(el => el.getClientRects().length > 0);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first) { event.preventDefault(); dialog?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
  }
  if (event.key !== 'Escape' || publishing.value) return; if (modal.value === 'leave') pending = null; modal.value = ''; siteMenu.value = false; mobileNav.value = false; }
function beforeUnload(event: BeforeUnloadEvent) { if (unsaved.value || publishing.value) { event.preventDefault(); event.returnValue = ''; } }
window.addEventListener('keydown', escape); window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => { document.body.style.overflow = ''; clearTimeout(toastTimer); window.removeEventListener('keydown', escape); window.removeEventListener('beforeunload', beforeUnload); });
if (['overview', 'products', 'pages', 'media', 'settings', 'publish'].includes(location.hash.slice(1))) section.value = location.hash.slice(1);
</script>

<template>
  <div class="studio">
    <a class="skip-link" href="#main-content">跳转到主要内容</a>
    <aside id="studio-sidebar" :inert="modal ? true : undefined" class="sidebar" :class="{ 'mobile-open': mobileNav }">
      <a class="wordmark" href="#overview" @click.prevent="go('overview')"><span class="brand-symbol">c<span></span></span>cms<span class="wordmark-suffix">studio</span></a>
      <div class="workspace-label">我的工作区 <span>专业版</span></div>
      <div class="site-picker-wrap">
        <button class="site-picker" @click="siteMenu = !siteMenu" :aria-expanded="siteMenu"><span class="site-avatar">{{ site.initials }}</span><span class="site-name">{{ site.name }}<small>{{ site.domain || '新网站 · 尚未发布' }}</small></span><Icon name="down" :size="15" /></button>
        <div v-if="siteMenu" class="site-menu">
          <div class="eyebrow">切换站点</div>
          <button v-for="s in sites" :key="s.id" @click="switchSite(s.id)"><span class="site-avatar small">{{ s.initials }}</span><span>{{ s.name }}</span><Icon v-if="s.id === selected" name="check" :size="16" /></button>
          <button class="create-site" @click="openNewSite"><Icon name="plus" :size="17" /> 创建新站点</button>
        </div>
      </div>
      <div class="nav-label">内容工作区</div>
      <nav aria-label="主导航"><button v-for="n in nav" :key="n.id" :class="{ active: section === n.id }" :aria-current="section === n.id ? 'page' : undefined" @click="go(n.id)"><Icon :name="n.icon" :size="19" /><span>{{ n.name }}</span><span v-if="n.id === 'pages'" class="nav-number">{{ site.items.filter(i => i.kind === 'page').length }}</span></button></nav>
      <div class="nav-divider"></div>
      <button class="publish-nav" :class="{ active: section === 'publish' }" :aria-current="section === 'publish' ? 'page' : undefined" @click="go('publish')"><Icon name="upload" :size="19" /><span>发布中心</span><span v-if="changed.length" class="count-pill">{{ changed.length }}</span></button>
      <div class="sidebar-bottom"><button @click="modal = 'guide'"><Icon name="help" :size="18" /> 操作指南 <Icon class="push" name="external" :size="14" /></button><button @click="modal = 'reset'"><Icon name="reset" :size="18" /> 重置演示数据</button><div class="profile"><span class="user-avatar">L</span><div>Lin<small>工作区管理员</small></div><span class="prototype-label">交互原型</span></div></div>
    </aside>
    <button v-if="mobileNav" class="nav-shade" aria-label="关闭导航" @click="mobileNav = false"></button>

    <div class="main-shell" :inert="modal ? true : undefined">
      <header class="topbar"><div class="breadcrumbs"><button class="mobile-menu icon-button" aria-label="展开导航" :aria-expanded="mobileNav" aria-controls="studio-sidebar" @click="mobileNav = !mobileNav"><Icon name="menu" /></button><span>{{ site.name }}</span><Icon name="chevron" :size="13" /><strong>{{ sectionName }}</strong><template v-if="editor"><Icon name="chevron" :size="13" /><strong>{{ editor.title || '新建内容' }}</strong></template></div><div class="topbar-right"><span class="demo-indicator"><i></i> 原型演示</span><button class="text-button" @click="preview('home', 'live')" :disabled="!anyLive">查看网站 <Icon name="external" :size="14" /></button><span class="top-avatar">L</span></div></header>
      <main id="main-content" tabindex="-1">
        <template v-if="editor">
          <div class="page-heading editor-heading"><div><button class="back-link" @click="go(section)"><Icon name="back" :size="16" /> 返回{{ editor.kind === 'product' ? '商品' : '页面' }}列表</button><h1>{{ editor.title || (editor.kind === 'product' ? '新建商品' : '新建页面') }} <span class="badge" :class="unsaved ? 'amber' : 'neutral'"><i v-if="unsaved"></i>{{ unsaved ? '未保存' : savedState }}</span></h1></div><div class="actions"><button class="button" @click="preview(editor.id)"><Icon name="eye" :size="17" /> 预览草稿</button><button class="button primary" @click="saveDraft()"><Icon name="check" :size="17" /> 保存草稿</button></div></div>
          <ol class="editor-flow" aria-label="内容更新步骤"><li class="current"><b>1</b> 编辑内容</li><li :class="{ complete: !unsaved && savedState === '草稿已保存' }"><b>2</b> 保存草稿</li><li><b>3</b> 预览确认</li><li><b>4</b> 检查并发布</li></ol>
          <div class="editor-notice"><Icon name="layers" :size="17" /><span>保存草稿后，预览并确认效果，再前往发布中心上线。</span><button @click="guarded(startPublish)">前往发布 <Icon name="arrow" :size="14" /></button></div>
          <div class="editor-layout"><div class="editor-main">
            <section class="panel form-panel"><h2>{{ editor.kind === 'product' ? '商品信息' : '页面内容' }}</h2><p class="muted">{{ editor.kind === 'product' ? '填写商品资料，网站将自动生成商品详情页。' : '直接修改访客看到的内容，页面关联由系统自动完成。' }}</p>
              <label class="field" for="field-title">{{ editor.kind === 'product' ? '商品名称' : '页面名称' }} <span>*</span><input id="field-title" :aria-invalid="!!formError" :aria-describedby="formError ? 'title-error' : undefined" v-model="editor.title" @input="formError = ''; suggestPath()" placeholder="输入名称" maxlength="100" /><small v-if="formError" id="title-error" class="field-error" role="alert">{{ formError }}</small><small v-if="editor.kind === 'page'">用于页面列表和网站导航，SEO 标题默认沿用此名称。</small></label>
              <div v-if="editor.kind === 'product'" class="field-row"><label class="field" for="field-price">商品价格 <span>*</span><div class="input-prefix"><span>¥</span><input id="field-price" v-model.number="editor.price" type="number" min="0" step="0.01" /></div></label><label class="field">商品分类<select v-model="editor.category"><option>家具</option><option>生活器物</option><option>灯具</option><option>其他</option></select></label></div>
              <label class="field" for="field-subtitle">{{ editor.kind === 'product' ? '商品简介' : '展示标题' }} <span>*</span><input id="field-subtitle" v-model="editor.subtitle" placeholder="写一句吸引访客的介绍" maxlength="150" /></label>
              <label class="field" for="field-body">{{ editor.kind === 'product' ? '商品详情' : '正文介绍' }}<textarea id="field-body" v-model="editor.body" rows="6" placeholder="讲述你的品牌或产品故事…"></textarea></label>
            </section>
            <section class="panel form-panel"><div class="section-heading"><div><h2>{{ editor.kind === 'product' ? '商品图片' : '页面主视觉' }}</h2><p class="muted">推荐横向图片，清晰的画面更有吸引力。</p></div><button class="button compact" @click="modal = 'asset'"><Icon name="image" :size="16" /> 替换图片</button></div><img class="editor-cover" :src="editor.image" alt="当前内容主视觉" /></section>
          </div><aside class="editor-side"><section class="panel form-panel"><h2>页面设置</h2><label class="field" for="field-path">访问路径<input id="field-path" v-model="editor.path" :disabled="editor.id === 'home'" /><small>完整地址：{{ site.domain || '你的域名' }}{{ editor.path }}</small></label><label v-if="editor.kind === 'page'" class="check-field"><input v-model="editor.navigation" type="checkbox" /> 显示在网站导航中</label><div class="gentle-note"><Icon name="sparkle" :size="17" /><span>已自动处理内容绑定和默认 SEO，无需额外配置。</span></div></section><section class="panel form-panel mini-preview"><div class="section-heading"><h2>效果预览</h2><Icon name="desktop" :size="17" /></div><img :src="editor.image" alt="页面缩略预览" /><h3>{{ editor.subtitle || '你的展示标题' }}</h3><p>{{ editor.body || '你的内容将在这里展示。' }}</p><button class="text-button" @click="preview(editor.id)">查看完整预览 <Icon name="arrow" :size="15" /></button></section></aside></div>
        </template>

        <template v-else-if="section === 'overview'">
          <div class="page-heading"><div><div class="eyebrow">WORKSPACE OVERVIEW</div><h1>工作台</h1><p>欢迎回来，Lin。管理内容，掌握网站的每一次更新。</p></div><button class="button primary" @click="startPublish"><Icon name="upload" :size="18" /> 发布修改 <span v-if="changed.length" class="button-count">{{ changed.length }}</span></button></div>
          <section class="metrics-grid" aria-label="网站内容概况">
            <button class="metric-card" @click="go('pages')"><span class="metric-label"><Icon name="page" :size="18" /> 网站页面</span><strong>{{ site.items.filter(i => i.kind === 'page').length }}</strong><span class="metric-footer">管理页面内容 <Icon name="arrow" :size="15" /></span></button>
            <button class="metric-card" @click="go('products')"><span class="metric-label"><Icon name="bag" :size="18" /> 商品</span><strong>{{ site.items.filter(i => i.kind === 'product').length }}</strong><span class="metric-footer">管理商品资料 <Icon name="arrow" :size="15" /></span></button>
            <button class="metric-card" @click="go('media')"><span class="metric-label"><Icon name="image" :size="18" /> 素材</span><strong>{{ assets.length }}</strong><span class="metric-footer">查看全部素材 <Icon name="arrow" :size="15" /></span></button>
            <button class="metric-card pending-metric" @click="go('publish')"><span class="metric-label"><Icon name="layers" :size="18" /> 待发布修改</span><strong>{{ changed.length }}<span class="metric-status">{{ changed.length ? '等待上线' : '已同步' }}</span></strong><span class="metric-footer">查看发布清单 <Icon name="arrow" :size="15" /></span></button>
          </section>
          <section class="release-banner"><span class="release-banner-icon"><Icon :name="changed.length ? 'layers' : 'check'" :size="22" /></span><div><h2>{{ changed.length ? `有 ${changed.length} 项内容等待发布` : '网站内容已同步' }}</h2><p>{{ changed.length ? '草稿已安全保存，预览确认后即可更新网站。' : '所有修改均已发布，可以开始下一次内容更新。' }}</p></div><button class="button" @click="startPublish">{{ changed.length ? '检查并发布' : '查看发布记录' }} <Icon name="arrow" :size="16" /></button></section>
          <section class="quick-section"><div class="section-heading"><h2>常用操作</h2><span class="muted">直接进入下一项任务</span></div><div class="quick-grid"><button class="quick-card" @click="edit(site.items.find(i => i.id === 'home')!)"><span class="quick-icon lavender"><Icon name="page" :size="22" /></span><strong>编辑首页</strong><span>更新文案与主视觉</span><Icon class="quick-arrow" name="arrow" :size="17" /></button><button class="quick-card" @click="createItem('product')"><span class="quick-icon peach"><Icon name="bag" :size="22" /></span><strong>新增商品</strong><span>填写资料，生成详情页</span><Icon class="quick-arrow" name="arrow" :size="17" /></button><button class="quick-card" @click="createItem('page')"><span class="quick-icon mint"><Icon name="plus" :size="22" /></span><strong>新增页面</strong><span>创建品牌与内容页面</span><Icon class="quick-arrow" name="arrow" :size="17" /></button><button class="quick-card" @click="go('media')"><span class="quick-icon blue"><Icon name="image" :size="22" /></span><strong>管理素材</strong><span>上传与复用内容图片</span><Icon class="quick-arrow" name="arrow" :size="17" /></button></div></section>
          <section v-if="!anyLive" class="panel setup-panel"><div class="section-heading"><div><h2>网站上线清单</h2><p class="muted">按顺序完善内容，完成第一次发布。</p></div><span class="badge neutral">{{ completedTasks }}/5 已完成</span></div><div class="progress-track"><span :style="{ width: `${completedTasks * 20}%` }"></span></div><button v-for="(task, index) in setupTasks" :key="task.name" class="setup-row" @click="task.action"><span class="task-circle" :class="{ done: task.done }"><Icon v-if="task.done" name="check" :size="14" /><template v-else>{{ index + 1 }}</template></span><span><strong>{{ task.name }}</strong><small>{{ task.detail }}</small></span><Icon name="arrow" :size="17" /></button></section>
          <div class="dashboard-content"><section class="panel recent-panel"><div class="section-heading"><div><h2>最近编辑</h2><p class="muted">继续处理网站内容</p></div><button class="text-button" @click="go('pages')">全部页面 <Icon name="arrow" :size="16" /></button></div><div class="list-head"><span>内容名称</span><span>发布状态</span><span>最近修改</span><span></span></div><button v-for="item in site.items.slice(0, 5)" :key="item.id" class="recent-row" @click="edit(item)"><span class="content-name"><span class="row-icon"><Icon :name="item.kind === 'product' ? 'bag' : 'page'" :size="18" /></span><span><strong>{{ item.title }}</strong><small>{{ item.path }}</small></span></span><span><span class="badge" :class="changed.some(i => i.id === item.id) ? 'amber' : 'green'">{{ changed.some(i => i.id === item.id) ? '待发布' : '已发布' }}</span></span><span class="muted row-date">{{ item.updated }}</span><Icon name="chevron" :size="16" /></button></section>
          <aside class="panel website-card"><div class="section-heading"><h2>当前网站</h2><span class="badge" :class="anyLive ? 'green' : 'amber'"><i></i>{{ anyLive ? '运行中' : '未发布' }}</span></div><button class="website-thumbnail" @click="preview()" aria-label="预览当前网站"><img :src="site.items.find(i => i.id === 'home')?.image" alt="当前网站首页主视觉" /><span><Icon name="eye" :size="18" /> 预览网站</span></button><h3>{{ site.name }}</h3><p class="website-domain">{{ site.domain || '尚未连接域名' }}</p><div class="website-details"><span>当前模板<strong>{{ site.theme }}</strong></span><span>上次发布<strong>{{ anyLive ? site.releases[0].at : '等待首次发布' }}</strong></span></div><button class="button full" @click="preview('home', anyLive ? 'live' : 'draft')"><Icon name="external" :size="16" /> {{ anyLive ? '查看线上版本' : '预览网站草稿' }}</button></aside></div>
          <section class="flow-summary" aria-label="内容更新流程"><span class="flow-summary-label">内容更新流程</span><span><b>1</b> 编辑内容</span><Icon name="chevron" :size="14" /><span><b>2</b> 保存草稿</span><Icon name="chevron" :size="14" /><span><b>3</b> 预览确认</span><Icon name="chevron" :size="14" /><span><b>4</b> 检查并发布</span><button class="text-button" @click="modal = 'guide'">查看指南 <Icon name="arrow" :size="15" /></button></section>
        </template>

        <template v-else-if="section === 'products' || section === 'pages'">
          <div class="page-heading"><div><div class="eyebrow">{{ section === 'products' ? 'PRODUCTS' : 'WEBSITE PAGES' }}</div><h1>{{ section === 'products' ? '商品管理' : '网站页面' }}<span class="heading-dot">.</span></h1><p>{{ section === 'products' ? '在这里管理商品，详情页面会自动生成。' : '内容、图片与页面设置，在一个地方完成。' }}</p></div><button class="button primary" @click="createItem(section === 'products' ? 'product' : 'page')"><Icon name="plus" :size="18" /> {{ section === 'products' ? '新增商品' : '新增页面' }}</button></div>
          <section class="panel content-list"><div class="list-toolbar"><div class="tab-buttons"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部{{ section === 'products' ? '商品' : '页面' }} <span>{{ site.items.filter(i => i.kind === (section === 'products' ? 'product' : 'page')).length }}</span></button><button :class="{ active: filter === 'changed' }" @click="filter = 'changed'">待发布修改</button></div><label class="search-field"><Icon name="search" :size="17" /><input v-model="search" :placeholder="section === 'products' ? '搜索商品名称…' : '搜索页面名称…'" aria-label="搜索内容" /></label></div><div v-if="!visibleItems.length" class="empty-state"><Icon name="search" :size="32" /><h2>{{ search ? '没有找到相关内容' : '这里还没有内容' }}</h2><p>尝试其他关键词，或创建一条新内容。</p></div>
          <template v-if="section === 'products'"><div class="product-grid"><button v-for="item in visibleItems" :key="item.id" class="product-card" @click="edit(item)"><div class="product-art"><img :src="item.image" :alt="item.title" /><span class="badge" :class="changed.some(c => c.id === item.id) ? 'amber' : 'green'">{{ changed.some(c => c.id === item.id) ? '待发布' : '已发布' }}</span><span class="product-edit"><Icon name="edit" :size="17" /> 编辑商品</span></div><div class="product-card-body"><span class="muted">{{ item.category }}</span><h3>{{ item.title }}</h3><div><strong>¥{{ Number(item.price).toLocaleString() }}</strong><span class="muted">{{ item.updated }}</span></div></div></button></div></template>
          <template v-else><button v-for="item in visibleItems" :key="item.id" class="page-row" @click="edit(item)"><img :src="item.image" alt="" /><span class="page-row-name"><strong>{{ item.title }} <span v-if="item.id === 'home'" class="badge neutral">首页</span></strong><small>{{ item.path }}</small></span><span class="nav-indicator">{{ item.navigation ? '显示在导航中' : '不在导航显示' }}</span><span class="badge" :class="changed.some(c => c.id === item.id) ? 'amber' : 'green'">{{ changed.some(c => c.id === item.id) ? '待发布' : '已发布' }}</span><Icon name="chevron" :size="17" /></button></template></section>
          <div class="inline-tip"><Icon name="help" :size="16" /> 保存后的内容会保留在草稿中，前往发布中心统一上线。</div>
        </template>

        <template v-else-if="section === 'media'"><div class="page-heading"><div><div class="eyebrow">MEDIA LIBRARY</div><h1>素材库</h1><p>集中管理图片，在编辑内容时直接选用。</p></div><button class="button primary" @click="uploadInput?.click()"><Icon name="upload" :size="17" /> 上传图片</button></div><section class="panel media-panel"><div class="section-heading"><h2>全部素材 <span class="muted">{{ assets.length }}</span></h2><span class="muted">支持 JPG、PNG、WebP · 单张最大 2MB</span></div><div class="asset-grid"><button v-for="(url, i) in assets" :key="url" class="asset-card" @click="previewItem = ''; modal = `image:${i}`"><img :src="url" :alt="assetNames[i] || '上传的图片'" /><strong>{{ assetNames[i] || `上传图片 ${i - 3}` }}</strong><small>{{ i < 4 ? 'SVG · 演示素材' : '本次会话上传' }}</small></button></div></section></template>

        <template v-else-if="section === 'settings'"><div class="page-heading"><div><div class="eyebrow">SITE SETTINGS</div><h1>网站设置</h1><p>常用设置触手可及，技术配置按需展开。</p></div></div><div class="settings-layout"><div class="settings-nav"><button v-for="tab in [{ id: 'brand', name: '品牌信息', icon: 'sparkle' }, { id: 'theme', name: '网站模板', icon: 'layers' }, { id: 'domain', name: '域名设置', icon: 'globe' }, { id: 'advanced', name: '高级管理', icon: 'settings' }]" :key="tab.id" :class="{ active: settingsTab === tab.id }" @click="settingsTab = tab.id"><Icon :name="tab.icon" :size="18" />{{ tab.name }}</button></div><section class="panel form-panel settings-content"><template v-if="settingsTab === 'brand'"><h2>品牌信息</h2><p class="muted">先告诉我们你的网站叫什么。</p><label class="field">网站名称<input v-model="brandName" maxlength="60" /></label><label class="field">品牌标识<span class="brand-logo-preview">{{ site.initials }}<span>{{ brandName }}</span></span><small>原型使用首字母标识，正式版可替换品牌 Logo。</small></label><button class="button primary" @click="saveBrand">保存设置</button></template><template v-else-if="settingsTab === 'theme'"><h2>当前网站模板</h2><img class="theme-cover" :src="art('interior')" alt="当前模板" /><h3>{{ site.theme }}</h3><p class="muted">包含首页、商品详情、内容页与网站导航。</p><div class="gentle-note"><Icon name="check" :size="18" /> 当前模板已安装，日常更新内容即可。</div></template><template v-else-if="settingsTab === 'domain'"><h2>域名设置</h2><p class="muted">原型展示绑定后的操作状态，不执行真实 DNS 验证。</p><label class="field">网站域名<input v-model="brandDomain" placeholder="例如 shop.example.com" /></label><div class="gentle-note"><Icon name="globe" :size="18" /> 正式版将引导添加 DNS 记录，并自动检查接入状态。</div><button class="button primary" @click="saveBrand">保存演示域名</button></template><template v-else><h2>高级管理</h2><p class="muted">面向管理员的配置集中在这里，日常内容维护无需进入。</p><button v-for="label in ['内容模型与字段', '可复用组件', '成员与权限', 'API 密钥与集成']" :key="label" class="advanced-row" @click="notify('本原型聚焦运营流程，高级配置沿用现有 CMS。')">{{ label }}<Icon name="chevron" :size="16" /></button></template></section></div></template>

        <template v-else-if="section === 'publish'"><div class="page-heading"><div><div class="eyebrow">PUBLISH CENTER</div><h1>发布中心</h1><p>先检查，再确认。每一次发布都有迹可循。</p></div><button class="button" @click="preview()"><Icon name="eye" :size="17" /> 预览整站草稿</button></div><div class="publish-layout"><div><section class="panel changes-panel"><div class="section-heading"><h2>本次发布内容 <span class="badge neutral">{{ changed.length }} 项修改</span></h2><span class="muted">草稿 → 网站</span></div><div v-if="!changed.length" class="empty-state"><span class="success-round"><Icon name="check" :size="28" /></span><h2>网站已是最新版本</h2><p>新的内容保存后，会自动出现在这里。</p><button class="button" @click="go('pages')">继续编辑内容</button></div><div v-for="item in changed" :key="item.id" class="change-row"><span class="row-icon"><Icon :name="item.kind === 'product' ? 'bag' : 'page'" :size="20" /></span><div class="change-detail"><h3>{{ item.title }} <span class="badge" :class="site.live.some(i => i.id === item.id) ? 'lavender-badge' : 'green'">{{ site.live.some(i => i.id === item.id) ? '内容更新' : '新增' }}</span></h3><p>{{ item.path }}</p><div v-if="site.live.find(i => i.id === item.id)?.subtitle !== item.subtitle" class="diff-line"><del v-if="site.live.find(i => i.id === item.id)">{{ site.live.find(i => i.id === item.id)?.subtitle || '空标题' }}</del><Icon name="arrow" :size="13" /><span>{{ item.subtitle || '尚未填写展示标题' }}</span></div><div v-if="item.kind === 'product' && site.live.find(i => i.id === item.id)?.price !== item.price" class="diff-line"><del v-if="site.live.find(i => i.id === item.id)">¥{{ site.live.find(i => i.id === item.id)?.price }}</del><Icon name="arrow" :size="13" /><span>¥{{ item.price }}</span></div></div><button class="text-button" @click="edit(item)">编辑 <Icon name="chevron" :size="14" /></button></div></section><section class="panel history-panel"><div class="section-heading"><h2><Icon name="history" :size="19" /> 发布历史</h2><span class="muted">{{ site.releases.length }} 个版本</span></div><p v-if="!site.releases.length" class="muted">首次发布后，将在这里记录版本。</p><div v-for="(release, i) in site.releases" :key="release.id" class="history-row"><span class="history-dot" :class="{ current: !i }"></span><div><strong>{{ release.id }} <span v-if="!i" class="badge green">当前线上版本</span></strong><p>{{ release.at }} · Lin 发布 · {{ release.count }} 项内容</p></div><button class="text-button" @click="preview('home', 'live')" v-if="!i">查看网站 <Icon name="external" :size="14" /></button><span v-else class="muted">已归档</span></div></section></div><aside><section class="panel publish-check"><div class="check-title"><span class="quick-icon lavender"><Icon name="sparkle" :size="22" /></span><h2>发布前检查</h2></div><p class="muted">自动检查必填内容、访问路径和商品价格。</p><template v-if="checkState === 'idle'"><div class="check-placeholder"><Icon name="check" :size="17" /> 内容完整性与访问路径</div><button class="button primary full" :disabled="!changed.length" @click="runCheck">检查并准备发布 <Icon name="arrow" :size="16" /></button></template><template v-else-if="checkState === 'checking'"><div class="checking-state" role="status"><span class="spinner"></span> 正在检查待发布内容…</div></template><template v-else-if="checkState === 'issues'"><div class="error-note" role="alert">发现 {{ problems.length }} 个问题，请修正后继续。</div><button v-for="(problem, i) in problems" :key="i" class="issue-row" @click="edit(site.items.find(item => item.id === problem.id)!, problem.field)"><Icon name="alert" :size="17" /><span>{{ problem.text }}<small>点击定位并修正</small></span><Icon name="chevron" :size="15" /></button><button class="button full" @click="runCheck">重新检查</button></template><template v-else><div class="check-success"><Icon name="check" :size="17" /> 所有检查已通过</div><div class="release-summary"><span>发布目标<strong>{{ site.name }}</strong></span><span>待发布修改<strong>{{ changed.length }} 项</strong></span><span>预计耗时<strong>约 2 秒 · 演示</strong></span></div><button class="button primary full" :disabled="!changed.length" @click="modal = 'confirm-publish'"><Icon name="upload" :size="17" /> 确认发布 {{ changed.length }} 项修改</button></template><p class="publish-footnote"><Icon name="help" :size="14" /> 发布前，线上内容保持当前版本。</p></section></aside></div></template>
        <footer class="page-footer"><span>CMS Studio <span class="footer-dot">·</span> 让内容管理回归简单</span><span>SaaS 交互原型 v2.0</span></footer>
      </main>
    </div>

    <input ref="uploadInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="upload" />
    <div v-if="toast" class="toast" role="status" aria-live="polite"><span><Icon name="check" :size="16" /></span>{{ toast }}</div>
    <div v-if="modal" class="modal-backdrop" @click.self="!publishing && (modal = '')">
      <section v-if="modal === 'preview'" class="preview-dialog" role="dialog" aria-modal="true" aria-label="网站预览"><header class="preview-toolbar"><div class="preview-toolbar-title"><Icon name="eye" :size="18" /><strong>{{ previewMode === 'live' ? '线上网站' : '草稿预览' }}</strong><span class="badge" :class="previewMode === 'live' ? 'green' : 'amber'">{{ previewMode === 'live' ? '已发布版本' : unsaved ? '包含未保存修改' : '尚未上线' }}</span></div><div class="preview-device"><button :class="{ active: viewport === 'desktop' }" :aria-pressed="viewport === 'desktop'" aria-label="桌面预览" @click="viewport = 'desktop'"><Icon name="desktop" :size="18" /></button><button :class="{ active: viewport === 'mobile' }" :aria-pressed="viewport === 'mobile'" aria-label="手机预览" @click="viewport = 'mobile'"><Icon name="mobile" :size="18" /></button></div><button class="icon-button" aria-label="关闭预览" @click="modal = ''"><Icon name="close" /></button></header><div class="preview-address"><Icon name="globe" :size="13" /> {{ site.domain || '新站点' }}{{ activePreview?.path || '/' }} <span>{{ previewMode === 'live' ? '演示线上快照' : '仅供预览，不会更新线上网站' }}</span></div><div class="preview-stage"><div class="storefront" :class="{ 'is-mobile': viewport === 'mobile', 'mono-theme': site.theme === '极简黑白' }"><template v-if="activePreview"><nav class="store-nav"><button class="store-brand" @click="previewItem = 'home'">{{ site.name.split(' ')[0] }}<span>.</span></button><div><button v-for="item in previewItems.filter(i => i.kind === 'page' && i.navigation)" :key="item.id" @click="previewItem = item.id">{{ item.title }}</button><button v-if="previewItems.some(i => i.kind === 'product')" @click="previewItem = previewItems.find(i => i.kind === 'product')!.id">精选好物</button></div><Icon name="bag" :size="17" /></nav><template v-if="activePreview.kind === 'product'"><div class="store-product"><img :src="activePreview.image" :alt="activePreview.title" /><div><span class="store-overline">THE EVERYDAY COLLECTION</span><h2>{{ activePreview.title }}</h2><h3>¥{{ Number(activePreview.price).toLocaleString() }}</h3><p>{{ activePreview.subtitle }}</p><p>{{ activePreview.body }}</p><button class="store-cta" @click="notify('商品展示原型：购买能力由交易系统提供。')">了解这件好物 <Icon name="arrow" :size="15" /></button></div></div></template><template v-else><div class="store-hero"><img :src="activePreview.image" :alt="activePreview.title" /><div><span class="store-overline">THOUGHTFULLY MADE, BEAUTIFULLY SIMPLE.</span><h2>{{ activePreview.subtitle || '你的展示标题' }}</h2><p>{{ activePreview.body }}</p><button class="store-cta" @click="previewItem = previewItems.find(i => i.kind === 'product')?.id || activePreview.id">探索生活好物 <Icon name="arrow" :size="15" /></button></div><span class="store-hero-caption">DESIGNED FOR EVERYDAY LIVING · 2026</span></div><div class="store-collection"><span class="store-overline">A LITTLE LESS. A LITTLE BETTER.</span><h2>恰好，喜欢。</h2><p>与日常相处，也与美好相遇。</p><div><button v-for="product in previewItems.filter(i => i.kind === 'product')" :key="product.id" @click="previewItem = product.id"><img :src="product.image" :alt="product.title" /><h3>{{ product.title }}</h3><span>¥{{ Number(product.price).toLocaleString() }}</span></button></div></div></template><footer class="store-footer">{{ site.name }}<span>用心设计，认真生活。</span></footer></template><div v-else class="empty-state"><Icon name="globe" :size="36" /><h2>这个页面还未发布</h2><p>请先发布网站，或切换到草稿预览。</p><button class="button" @click="previewMode = 'draft'; previewItem = 'home'">查看草稿</button></div></div></div></section>

      <section v-else-if="modal === 'asset'" class="dialog asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-title"><div class="dialog-heading"><div><div class="eyebrow">MEDIA LIBRARY</div><h2 id="asset-title">为内容选择一张图片</h2></div><button class="icon-button" aria-label="关闭素材选择" @click="modal = ''"><Icon name="close" /></button></div><div class="asset-grid"><button v-for="(url, i) in assets" :key="url" class="asset-card" @click="selectAsset(url)"><img :src="url" :alt="assetNames[i] || '上传图片'" /><strong>{{ assetNames[i] || '上传的图片' }}</strong><small>{{ editor?.image === url ? '当前使用' : '点击选用' }}</small></button></div><button class="button" @click="uploadInput?.click()"><Icon name="upload" :size="16" /> 上传新图片</button></section>
      <section v-else-if="modal.startsWith('image:')" class="dialog image-dialog" role="dialog" aria-modal="true" aria-label="素材大图"><div class="dialog-heading"><h2>{{ assetNames[Number(modal.split(':')[1])] || '上传的图片' }}</h2><button class="icon-button" aria-label="关闭大图" @click="modal = ''"><Icon name="close" /></button></div><img :src="assets[Number(modal.split(':')[1])]" alt="素材大图" /></section>
      <section v-else-if="modal === 'new-site'" class="dialog new-site-dialog" role="dialog" aria-modal="true" aria-labelledby="new-site-title"><div class="dialog-heading"><div><div class="eyebrow">A NEW BEGINNING</div><h2 id="new-site-title">创建你的下一个网站</h2></div><button class="icon-button" aria-label="关闭创建站点" @click="modal = ''"><Icon name="close" /></button></div><div class="wizard-steps"><span class="active">1 网站信息</span><i></i><span :class="{ active: wizardStep === 2 }">2 选择模板</span></div><template v-if="wizardStep === 1"><p class="muted">填写一个名称，模板会为你准备好页面和内容结构。</p><label class="field">网站名称<input v-model="newName" placeholder="例如：新站点 · 我的设计商店" maxlength="60" @keyup.enter="newName.trim() && (wizardStep = 2)" /></label><p v-if="formError" class="error-note">{{ formError }}</p><div class="dialog-actions"><button class="button" @click="modal = ''">取消</button><button class="button primary" :disabled="!newName.trim()" @click="wizardStep = 2">选择网站模板 <Icon name="arrow" :size="16" /></button></div></template><template v-else><p class="muted">两套风格使用相同的操作流程，创建后即可开始修改。</p><div class="theme-options"><button v-for="theme in ['自然留白', '极简黑白']" :key="theme" :class="{ selected: newTheme === theme }" @click="newTheme = theme"><div class="theme-mini" :class="{ mono: theme === '极简黑白' }"><img :src="art('interior')" alt="模板预览" /><span>Less, but better.</span></div><strong>{{ theme }} <Icon v-if="newTheme === theme" name="check" :size="17" /></strong><small>首页 · 商品详情 · 内容页</small></button></div><div class="gentle-note"><Icon name="sparkle" :size="17" /> 模板内容结构将自动创建，无需手动配置字段。</div><div class="dialog-actions"><button class="button" @click="wizardStep = 1">上一步</button><button class="button primary" @click="createSite">创建并开始编辑 <Icon name="arrow" :size="16" /></button></div></template></section>
      <section v-else-if="modal === 'leave'" class="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title"><span class="dialog-icon amber"><Icon name="edit" :size="24" /></span><h2 id="leave-title">还有修改没有保存</h2><p>保存为草稿后再离开，稍后可以继续编辑。</p><div class="dialog-actions vertical-options"><button class="button primary" @click="resolveLeave(true)">保存草稿并继续</button><button class="button" @click="resolveLeave(false)">放弃修改并继续</button><button class="text-button" @click="pending = null; modal = ''">留在这里</button></div></section>
      <section v-else-if="modal === 'confirm-publish'" class="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span class="dialog-icon lavender"><Icon name="upload" :size="25" /></span><h2 id="confirm-title">将这次修改发布到网站？</h2><p>将更新「{{ site.name }}」的 {{ changed.length }} 项内容。发布完成后，访客会看到新版本。</p><div class="gentle-note"><Icon name="check" :size="17" /> 内容、访问路径和商品价格检查已通过</div><div class="dialog-actions"><button class="button" @click="modal = ''">再看看</button><button class="button primary" @click="publish">确认发布</button></div></section>
      <section v-else-if="modal === 'publishing'" class="dialog small-dialog" role="dialog" aria-modal="true" aria-label="正在发布"><span class="dialog-icon lavender"><span class="spinner"></span></span><h2>正在让新内容上线</h2><p>演示发布进行中，请稍候。</p><div class="publishing-steps"><div v-for="(label, i) in ['准备发布内容', '生成网站版本', '更新线上网站']" :key="label"><span :class="{ done: publishPhase > i }"><Icon :name="publishPhase > i ? 'check' : 'clock'" :size="17" /></span>{{ label }}</div></div></section>
      <section v-else-if="modal === 'published'" class="dialog small-dialog published-dialog" role="dialog" aria-modal="true" aria-labelledby="published-title"><span class="dialog-icon mint"><Icon name="check" :size="30" /></span><div class="eyebrow">LOOKING GOOD, NOW LIVE.</div><h2 id="published-title">新内容，已经上线。</h2><p>演示网站已更新为最新版本。现在打开网站，就能看到你的修改。</p><div class="dialog-actions"><button class="button" @click="modal = ''; go('overview')">返回概览</button><button class="button primary" @click="preview('home', 'live')">查看网站 <Icon name="external" :size="16" /></button></div></section>
      <section v-else-if="modal === 'reset'" class="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">重新开始这次体验？</h2><p>将清除原型中的编辑、新建站点和发布记录，恢复初始演示数据。</p><div class="dialog-actions"><button class="button" @click="modal = ''">取消</button><button class="button primary" @click="reset">重置演示</button></div></section>
      <section v-else-if="modal === 'guide'" class="dialog guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title"><div class="dialog-heading"><div><div class="eyebrow">TRY IT YOURSELF</div><h2 id="guide-title">用几个真实任务，体验新流程</h2></div><button class="icon-button" aria-label="关闭指南" @click="modal = ''"><Icon name="close" /></button></div><p class="muted">所有操作使用本地演示数据，保存后刷新可继续。可随时在左下角重置。</p><div class="guide-flows"><button @click="modal = ''; edit(site.items.find(i => i.id === 'home')!)"><span>01</span><div><h3>修改首页并发布</h3><p>编辑首页 → 替换图片/文案 → 保存草稿 → 发布检查 → 确认上线</p></div><Icon name="arrow" :size="18" /></button><button @click="modal = ''; createItem('page')"><span>02</span><div><h3>新增一个品牌页面</h3><p>新增页面 → 填写内容 → 自动生成路径和绑定 → 预览 → 发布</p></div><Icon name="arrow" :size="18" /></button><button @click="modal = ''; createItem('product')"><span>03</span><div><h3>新增商品，体验问题修复</h3><p>填写名称，价格留空 → 保存 → 发布检查 → 定位问题 → 补全后发布</p></div><Icon name="arrow" :size="18" /></button><button @click="openNewSite"><span>04</span><div><h3>从零创建一个新网站</h3><p>填写站名 → 选择模板 → 按建站清单完善 → 预览发布</p></div><Icon name="arrow" :size="18" /></button></div></section>
    </div>
  </div>
</template>
