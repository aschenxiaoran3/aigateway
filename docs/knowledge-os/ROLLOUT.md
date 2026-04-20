# Knowledge OS / DeepWiki 试点说明

## 试点仓库建议

1. **单仓后端服务**：在 `ai-rules/skills/knowledge-os/project-overrides/<repo_slug>.yaml` 中适当提高 `coverage.min_overall_score`，观察 `coverage_report.json` 与 `meta/coverage-gaps` 补页。
2. **ai-platform 本仓库**：验证双写是否落在 `docs/deepwiki/<commit>/`（需 `snapshot.local_path` 指向可写检出目录）。

## 回归检查

- 一次 DeepWiki run 完成后 `output_root` 下应存在：
  - `skills_spec_snapshot.yaml`
  - `artifacts/stage_assets.json`、`artifacts/coverage_report.json`
  - `document-bundle/PRD.generated.md`、`技术方案.generated.md`、`测试方案.generated.md`
- 控制面日志含「双写」成功或跳过原因。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPWIKI_BLOCK_PUBLISH_ON_COVERAGE=1` | Coverage 未通过时将质量状态降为 draft |
| `quality-gates.yaml` 中 `coverage.block_publish_on_fail: true` | 同上，由规范文件控制 |

## 管理 UI

浏览器打开控制面：`http://<host>:<port>/deepwiki/knowledge-os-admin`  
API：`GET/PUT /api/v1/deepwiki/knowledge-os/file` 等。
