import { defineComponent, onMounted, ref } from 'vue';
import { userErrorMessage } from '../../util/user-message';
import { analyticsMetric, analyticsViewState } from './analytics-state';

type Analytics = { status: 'ready' | 'unconfigured'; days: number; message?: string; totals?: { views: number; visitors: number }; pages?: Array<{ path: string; views: number }> };
export default defineComponent({ setup() {
  const sdk = window.bcms.sdk; const days = ref('7'); const data = ref<Analytics | null>(null); const loading = ref(true); const error = ref('');
  const state = () => analyticsViewState({ loading: loading.value, error: error.value, configured: data.value?.status !== 'unconfigured', hasData: Boolean(data.value) });
  async function load() { loading.value = true; error.value = ''; data.value = null; try { data.value = await sdk.send<Analytics>({ url: `/api/v4/analytics/?days=${days.value}`, method: 'GET' }); } catch (cause) { error.value = userErrorMessage(cause) || '访问数据暂时无法加载'; } finally { loading.value = false; } }
  onMounted(load);
  return () => <section class="studio-card leads-panel"><div class="studio-card-heading"><div><p class="studio-eyebrow">TRAFFIC OVERVIEW</p><h1>访问数据</h1><p class="studio-help">公开页面异步上报的访问聚合，统计服务故障不影响网站访问。</p></div><select aria-label="统计周期" value={days.value} onChange={event => { days.value = (event.target as HTMLSelectElement).value; void load(); }}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select></div>
    {state() === 'error' || state() === 'unconfigured' ? <div role="alert" class="studio-warning"><strong>{state() === 'unconfigured' ? '访问数据尚未配置' : '访问数据暂时不可用'}</strong><p>{state() === 'unconfigured' ? '当前站点未绑定统计服务，因此无法确认访问量；这里不将“未配置”显示为 0。请联系管理员配置 Gateway 统计服务。' : error.value}</p><button type="button" class="studio-button secondary" onClick={load}>重新加载</button></div>
      : state() === 'loading' ? <p class="studio-help">正在加载访问数据…</p>
      : <><div class="studio-metric-grid"><div class="studio-metric"><span>页面访问</span><strong>{analyticsMetric(data.value?.totals?.views, state())}</strong></div><div class="studio-metric"><span>匿名访客</span><strong>{analyticsMetric(data.value?.totals?.visitors, state())}</strong></div></div><div class="leads-table" role="table"><div class="leads-row leads-head" role="row"><span>页面</span><span>访问次数</span><span></span><span></span><span></span></div>{(data.value?.pages || []).map(item => <div class="leads-row" role="row" key={item.path}><strong>{item.path}</strong><span>{item.views}</span><span></span><span></span><span></span></div>)}{!data.value?.pages?.length && <p class="studio-help">统计服务已连接，所选周期暂无访问数据。</p>}</div></>}
  </section>;
} });
