# gateway_wiki_* 表 × 路由 × Admin UI 对照

本文档描述 `gateway_wiki_*` 系列表（不含 `gateway_deepwiki_*` 运行页表）在控制平面与 Admin UI 中的对应关系。

- **路由**：[`control-plane/src/index.js`](../control-plane/src/index.js) `/api/v1/deepwiki/*`
- **前端 API**：[`admin-ui/src/services/api.ts`](../admin-ui/src/services/api.ts) `deepWikiApi`
- **工作区**：[`admin-ui/src/pages/deepwiki/useDeepWikiWorkspace.ts`](../admin-ui/src/pages/deepwiki/useDeepWikiWorkspace.ts)
- **页面路由**：`/deepwiki`、`/deepwiki/project/:projectId`（[`App.tsx`](../admin-ui/src/App.tsx)）

## 按表对照

| 表 | 主要 REST | admin-ui |
|----|-----------|----------|
| `gateway_wiki_projects` | `GET/POST /api/v1/deepwiki/projects`，`GET .../projects/:id`，`POST .../bootstrap` | 项目列表、工作台 |
| `gateway_wiki_project_repos` | `GET .../projects/:id/repos`，`POST .../projects/:id/repos` | 多仓绑定 |
| `gateway_wiki_branches` | `GET .../projects/:id/branches` | 分支选择 |
| `gateway_wiki_branch_repo_mappings` | `POST /api/v1/deepwiki/branches/:id/repo-mapping` | 逐仓映射保存 |
| `gateway_wiki_snapshots` | `GET .../projects/:id/snapshots`，`GET .../runs/:id`（嵌套 `snapshot`） | 快照选择 |
| `gateway_wiki_snapshot_repo_revisions` | `GET .../deepwiki/snapshots/:id/repo-revisions` | 工作台 revisions 列表 |
| `gateway_wiki_quality_reports` | `GET .../snapshots/:id/quality-report` | 质量卡片 |
| `gateway_wiki_generation_jobs` | 随 `GET .../runs/:id` 返回 `generation_jobs` | Run 英雄卡展示 |
| `gateway_wiki_objects` | `GET .../snapshots/:id/objects` | Wiki 浏览 Objects |
| `gateway_wiki_evidence` | 无独立列表 API | Run 详情 `evidence_coverage` 聚合 |
| `gateway_wiki_relations` | 无独立列表 API | Run 详情 `relation_counts` 聚合 |
| `gateway_wiki_consistency_checks` | `GET .../snapshots/:id/consistency-checks` | Wiki 浏览 Consistency 分段 |
| `gateway_wiki_flows` / `gateway_wiki_flow_steps` | `GET .../snapshots/:id/flows` | Wiki 浏览 Flows |
| `gateway_wiki_assertions` | `GET .../snapshots/:id/assertions` | Wiki 浏览 Assertions |
| `gateway_wiki_scenarios` | `GET .../snapshots/:id/scenarios` | Wiki 浏览 Scenarios |
| `gateway_wiki_semantic_scores` | `GET .../snapshots/:id/semantic-scores` | Wiki 浏览 Scores |
| `gateway_wiki_feedback_events` | `GET .../projects/:projectId/feedback-events`；`POST .../deepwiki/feedback/:pipelineType` | 工作台列表与提交表单 |

## 后端有、前端未接的 Deep Wiki 路由（可选集成）

- `GET /api/v1/deepwiki/projects/:id/default-published-snapshot`：控制平面已注册，若需要「默认已发布快照」可在 `deepWikiApi` 增加封装并在 UI 使用。
- `GET /api/v1/deepwiki/runs/:id/pages`：列表接口；当前运行页树仍主要来自 `getRun` 返回的 `pages`。

## 结论

- **Schema / 流水线**：各表均在 [`control-plane/src/db/mysql.js`](../control-plane/src/db/mysql.js) Deep Wiki 路径中有读写。
- **路由 + UI**：绝大多数表可通过 GET 或 Run 聚合在 Admin UI 中观测；一致性检查与反馈写入已按上表对接。
