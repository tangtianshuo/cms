import { defineComponent, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';

interface SiteOperationsStatus {
    site: { id: string; name: string; status: string } | null;
    domain: { configured: boolean; verified: number; ready: number; primaryHostname?: string };
    https: { status: string; reason?: string };
    backup: { status: string; latestAt?: number; restore: string };
    storefront: { status: string; checkedAt: number };
    gateway: { status: string; activeRevision?: number };
    recentPublishes: Array<{ id: string; createdAt: number; status: string; error?: string }>;
}

const labels: Record<string, string> = { ready: '已就绪', pending: '待处理', error: '检查失败', unknown: '未知', unconfigured: '未配置', healthy: '正常', failed: '失败', published: '已发布', available: '可用' };
export const SiteOperations = defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const state = ref<SiteOperationsStatus>();
        const error = ref('');
        const loading = ref(true);
        async function refresh() {
            loading.value = true; error.value = '';
            try { state.value = await sdk.send<SiteOperationsStatus>({ url: '/api/v4/presets/operations', method: 'GET' }); }
            catch (cause) { error.value = cause instanceof Error ? cause.message : '运营状态暂时无法读取'; }
            finally { loading.value = false; }
        }
        onMounted(refresh);
        const status = (value: string) => labels[value] || value;
        return () => <section class="studio-card site-operations-panel">
            <div class="studio-card-heading"><div><p class="studio-eyebrow">SITE OPERATIONS</p><h2>网站运营状态</h2></div><button class="secondary" type="button" onClick={refresh} disabled={loading.value}>刷新</button></div>
            {loading.value && <p role="status" class="studio-help">正在读取当前网站状态…</p>}
            {error.value && <p role="alert" class="studio-warning">{error.value}</p>}
            {state.value?.site && <><p class="studio-help">{state.value.site.name} · 状态：{status(state.value.site.status)}</p><div class="site-operations-grid">
                <article><h3>域名与 HTTPS</h3><p>{state.value.domain.primaryHostname || '尚未设置主域名'}</p><p>归属已验证 {state.value.domain.verified} 个，已接入 {state.value.domain.ready} 个</p><strong>{status(state.value.https.status)}</strong><RouterLink to="/d/domains">管理域名</RouterLink></article>
                <article><h3>备份与恢复</h3><p>最近备份：{state.value.backup.latestAt ? new Date(state.value.backup.latestAt).toLocaleString() : '尚无可确认的备份'}</p><strong>{status(state.value.backup.status)}</strong><RouterLink to="/d/settings">打开备份</RouterLink></article>
                <article><h3>网站健康</h3><p>Storefront：{status(state.value.storefront.status)}</p><p>Gateway：{status(state.value.gateway.status)}</p><strong>检查时间：{new Date(state.value.storefront.checkedAt).toLocaleString()}</strong></article>
            </div><div class="site-operations-history"><h3>最近发布</h3>{state.value.recentPublishes.length ? state.value.recentPublishes.map(item => <p><code>{item.id.slice(0, 8)}</code> · {new Date(item.createdAt).toLocaleString()} · {status(item.status)}{item.error ? ` · ${item.error}` : ''}</p>) : <p class="studio-help">暂无发布记录</p>}</div></>}
        </section>;
    },
});
