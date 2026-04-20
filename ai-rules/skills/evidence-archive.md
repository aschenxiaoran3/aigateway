# Evidence Archive

输入：

- `trace_id`
- `project_code`
- `milestone_type`
- `node_outputs`

输出：

- 证据包标题
- 证据项列表
- 缺失项说明

规则：

- 证据项必须按 `trace / artifact / metric / audit / approval` 分类。
- 若关键节点缺失输出，必须显式标红并建议人工补录。
