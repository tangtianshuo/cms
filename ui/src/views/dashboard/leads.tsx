import { computed, defineComponent, onMounted, ref } from 'vue';
import { buildLeadsQuery, leadUpdatePayload, leadViewState } from './leads-state';

type Lead = { _id: string; createdAt: number; source: string; name?: string; email?: string; phone?: string; message?: string; fields?: Record<string, string>; status: string; assignedTo?: string; notes?: string; notificationStatus: string };
const statuses = ['new', 'contacted', 'qualified', 'closed', 'spam'] as const;

export default defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const items = ref<Lead[]>([]); const loading = ref(true); const error = ref(''); const filter = ref(''); const search = ref('');
        const assigned = ref<Record<string, string>>({}); const busy = ref(false);
        const visible = computed(() => items.value.filter(item => !filter.value || item.status === filter.value));
        async function load() {
            loading.value = true; error.value = '';
            try { const result = await sdk.send<{ items: Lead[] }>({ url: `/api/v4/leads/?${buildLeadsQuery(filter.value, search.value)}`, method: 'GET' }); items.value = result.items; }
            catch (cause) { error.value = cause instanceof Error ? cause.message : '询盘暂时无法加载'; }
            finally { loading.value = false; }
        }
        async function update(item: Lead, patch: Partial<Lead>) {
            if (busy.value) return;
            busy.value = true; error.value = '';
            try { await sdk.send({ url: `/api/v4/leads/${encodeURIComponent(item._id)}`, method: 'POST', data: leadUpdatePayload(patch) }); delete assigned.value[item._id]; await load(); }
            catch (cause) { error.value = cause instanceof Error ? cause.message : '询盘更新失败，请重试。'; }
            finally { busy.value = false; }
        }
        async function exportCsv() {
            if (busy.value) return;
            busy.value = true; error.value = '';
            let href: string | undefined;
            try {
                const bytes = await sdk.send<Blob>({ url: '/api/v4/leads/export', method: 'GET', responseType: 'blob' });
                href = URL.createObjectURL(bytes);
                const link = document.createElement('a'); link.href = href; link.download = 'leads.csv';
                document.body.append(link); link.click(); link.remove();
            } catch (cause) { error.value = cause instanceof Error ? cause.message : '询盘导出失败，请重试。'; }
            finally { if (href) { const downloadUrl = href; setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000); } busy.value = false; }
        }
        onMounted(load);
        return () => <section class="studio-card leads-panel">
            <div class="studio-card-heading"><div><p class="studio-eyebrow">LEAD INBOX</p><h1>询盘</h1><p class="studio-help">独立接收入口写入的客户咨询，页面访问不依赖后台可用。</p></div><button class="studio-button" disabled={busy.value} onClick={exportCsv}>导出 CSV</button></div>
            <div class="leads-toolbar"><input aria-label="搜索询盘" placeholder="搜索姓名、邮箱或内容" value={search.value} onInput={event => { search.value = (event.target as HTMLInputElement).value; }} onKeyup={event => { if (event.key === 'Enter') void load(); }} /><select aria-label="询盘状态" value={filter.value} onChange={event => { filter.value = (event.target as HTMLSelectElement).value; void load(); }}><option value="">全部状态</option>{statuses.map(status => <option value={status}>{status}</option>)}</select><button class="studio-button secondary" onClick={load}>刷新</button></div>
            {error.value && <p class="studio-warning" role="alert">{error.value}</p>}
            {leadViewState({ loading: loading.value, error: error.value, count: visible.value.length }) === 'loading' ? <p class="studio-help">正在加载询盘…</p> : leadViewState({ loading: loading.value, error: error.value, count: visible.value.length }) === 'error' ? null : leadViewState({ loading: loading.value, error: error.value, count: visible.value.length }) === 'empty' ? <p class="studio-help">暂无符合条件的询盘。</p> : <div class="leads-table" role="table"><div class="leads-row leads-head" role="row"><span>联系人</span><span>来源</span><span>内容</span><span>状态</span><span>时间</span></div>{visible.value.map(item => <article class="leads-row" role="row" key={item._id}><div><strong>{item.name || '未填写姓名'}</strong><small>{item.email || item.phone || '未提供联系方式'}</small></div><span>{item.source}</span><p>{item.message || Object.values(item.fields || {}).join(' · ') || '—'}</p><div><select disabled={busy.value} aria-label={`${item.name || item.email || item._id} 状态`} value={item.status} onChange={event => void update(item, { status: (event.target as HTMLSelectElement).value })}>{statuses.map(status => <option value={status}>{status}</option>)}</select><label>负责人<input aria-label={`${item.name || item.email || item._id} 负责人`} maxlength={120} disabled={busy.value} value={assigned.value[item._id] ?? item.assignedTo ?? ''} onInput={event => { assigned.value[item._id] = (event.target as HTMLInputElement).value; }} /></label><button type="button" class="studio-button secondary" disabled={busy.value || assigned.value[item._id] === undefined} onClick={() => void update(item, { assignedTo: assigned.value[item._id].trim() })}>保存负责人</button></div><time datetime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div>}
        </section>;
    },
});
