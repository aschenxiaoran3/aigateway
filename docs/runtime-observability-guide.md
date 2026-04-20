# 运行编排与可观测说明

## 1. 运行编排页看什么

- 当前 trace 属于哪个管道
- 当前执行到哪个节点
- 哪个节点阻断
- 是否已经生成测试方案
- 是否已经形成 evidence pack

## 2. 关键观察对象

- `gateway_pipeline_runs`
- `gateway_run_nodes`
- `gateway_doc_bundles`
- `gateway_doc_gate_executions`
- `gateway_evidence_packs`

## 3. 关键度量

- 运行总数
- 完成数 / 阻断数 / 失败数
- 文档门禁通过率
- 测试方案门禁通过率
- 知识引用命中率

## 4. 演示建议

- 使用默认 trace 样例验证页面聚合是否正确
- 使用文档管道发布样例验证工作流阶段推进是否正确
