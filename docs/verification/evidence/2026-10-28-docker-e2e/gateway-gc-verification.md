# Gateway 自动退役补验

- 原始红灯：新增真实发布数量断言失败，信息为 `automatic retirement must retain at most current + previous containers, got 3`。修复后的复跑日志为 gateway-gc-flow-e2e.log。
- Gateway 全套测试：95 control + 2 contracts + 67 worker；0 失败、0 跳过，真实 PostgreSQL 已启用。
- Gateway npm run typecheck：control/contracts/worker 均 exit 0。
- 真实 Docker：发布/回滚、失败保护与重启恢复、删除 503 故障和再次重启后自动补清均通过。
- 只读代码复核：未发现需要修正的问题，未修改工作区。
- Gateway 新镜像本地构建 exit 0；宿主 worker 加载当前代码，control 服务不因纯 worker 修改重建。
- 最终健康、匿名媒体校验和数量审计见 gateway-gc-smoke.json。
