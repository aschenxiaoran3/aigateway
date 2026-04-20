INSERT INTO `gateway_waves`
(`code`, `name`, `stage`, `goal`, `entry_criteria`, `exit_criteria`, `start_date`, `end_date`, `status`)
VALUES
('W1', '阶段一基础设施波次', 'foundation', '完成 AI 网关、ai-rules、工作手册、知识库覆盖与度量基线', 'Q2 启动', 'Foundation 交付物通过 4/30 闸口验收', '2026-04-01', '2026-04-30', 'active'),
('W2', '阶段二 ThinCore 波次', 'thin_core', '完成编排引擎、统一 API、Agent 规范、Schema/技能包与可观测底座', 'F01 网关可用', '5/31 前 ThinCore MVP 联调完成', '2026-04-21', '2026-05-30', 'active'),
('W3', '阶段二管道与门禁波次', 'pipeline', '完成五大自动化管道 MVP、RAG 集成与统一门禁策略', 'C01-C04 内核就绪', '至少 1 条真实链路可运行并可追溯', '2026-05-15', '2026-06-20', 'active'),
('W4', '阶段二集成与治理波次', 'governance', '完成新老项目双样板验证、认证绩效、提效报告与复盘收官', '管道 MVP 上线', '6/30 终验、提效报告与 AI 型项管流程输出', '2026-06-15', '2026-06-30', 'active')
ON DUPLICATE KEY UPDATE
`name` = VALUES(`name`),
`stage` = VALUES(`stage`),
`goal` = VALUES(`goal`),
`entry_criteria` = VALUES(`entry_criteria`),
`exit_criteria` = VALUES(`exit_criteria`),
`start_date` = VALUES(`start_date`),
`end_date` = VALUES(`end_date`),
`status` = VALUES(`status`);

UPDATE `gateway_program_projects`
SET
  `official_order` = 999,
  `okr_stage` = COALESCE(`okr_stage`, 'legacy'),
  `metadata_json` = JSON_SET(COALESCE(`metadata_json`, JSON_OBJECT()), '$.legacy_catalog', true)
WHERE `code` NOT IN (
  'F01', 'F02', 'F03', 'F04', 'F05',
  'G03', 'P05',
  'C01', 'C02', 'C03', 'C04', 'C05',
  'P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P08',
  'G01', 'G02', 'G04'
);

INSERT INTO `gateway_program_projects`
(`code`, `name`, `layer`, `okr_stage`, `wave_id`, `official_order`, `okr_refs`, `owner_role`, `co_owner_roles`, `start_date`, `end_date`, `status`, `risk_level`, `summary`, `acceptance_rule`, `metadata_json`)
SELECT * FROM (
  SELECT 'F01', 'AI 网关部署与全员接入', 'foundation', '阶段一', w.id, 1, JSON_ARRAY('KR10.1'), '平台组', JSON_ARRAY('全部组'), '2026-04-01', '2026-04-20', 'active', 'low', '统一 AI 网关、用量、成本与安全审计可用。', '网关生产环境可用，接入率 100%。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W1', 'checkpoint_430', '网关上线，接入率100%') FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL SELECT 'F02', 'ai-rules 仓库与 AI 工作手册 V1.0', 'foundation', '阶段一', w.id, 2, JSON_ARRAY('KR10.1', 'KR10.3-ENG'), '平台组', JSON_ARRAY('产品组', '后端组', '测试组'), '2026-04-01', '2026-04-25', 'active', 'low', '建立 ai-rules 统一规则源，沉淀 PM/RD/QA 工作手册。', 'ai-rules 仓库上线，AI 工作手册 V1.0 定版。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W1', 'checkpoint_430', '仓库上线，PM/RD/QA 手册定版') FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL SELECT 'F03', '企业知识库初始化与文档覆盖', 'foundation', '阶段一', w.id, 3, JSON_ARRAY('KR10.1'), '平台组', JSON_ARRAY('各组'), '2026-04-07', '2026-04-30', 'active', 'medium', '完成工程文档目录梳理、知识资产建档与覆盖率统计。', '知识库覆盖率达到 70% 以上。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W1', 'checkpoint_430', '知识覆盖率>=70%') FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL SELECT 'F04', '各组规范定版与单点闭环验证', 'foundation', '阶段一', w.id, 4, JSON_ARRAY('KR10.1', '各组O1'), '各组负责人', JSON_ARRAY('平台组', '上下游组'), '2026-04-01', '2026-04-30', 'active', 'medium', '完成产品/研发/测试/运维规范与各组最小闭环样板。', '规范定版、闭环样板>=1；测试接口/UI 各 >=1 场景并形成需求级测试闭环。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W1', 'checkpoint_430', '规范定版与闭环样板') FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL SELECT 'F05', 'AI 效率基线采集与度量体系', 'foundation', '跨阶段', w.id, 5, JSON_ARRAY('KR10.1', 'KR10.4'), '项管组', JSON_ARRAY('各组', '平台组'), '2026-04-07', '2026-05-10', 'active', 'medium', '完成阶段一基线口径、阶段二持续采集与仪表盘支撑。', '4/30 完成口径和基线采集；6/30 支撑提效报告输出。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W1', 'checkpoint_430', '口径定版与基线采集', 'checkpoint_531', '仪表盘上线', 'checkpoint_630', '提效报告支撑') FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL SELECT 'G03', '认证绩效 + 提效分析报告', 'governance', '跨阶段', w.id, 6, JSON_ARRAY('KR10.4'), '技术总监+项管', JSON_ARRAY('HR', '各组'), '2026-04-21', '2026-06-30', 'active', 'medium', '形成 AI 能力认证标准、绩效挂钩机制与专项提效分析报告。', '4/30 发布认证标准；6/30 完成首轮认证和提效报告。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W4', 'checkpoint_430', '认证标准与绩效权重方案发布', 'checkpoint_630', '认证完成并输出提效报告') FROM gateway_waves w WHERE w.code = 'W4'
  UNION ALL SELECT 'P05', '产品管道价值初评 V1.0', 'pipeline', '跨阶段', w.id, 7, JSON_ARRAY('KR10.3-PIPE'), '大数据+产品', JSON_ARRAY('平台组'), '2026-05-10', '2026-06-15', 'active', 'medium', '沉淀价值衡量口径、价值初评 Agent 与产品确认留痕。', '4/30 完成价值口径 V1.0；6/30 进入开发需求 100% 挂接价值初评。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_430', '价值口径 V1.0', 'checkpoint_531', '初评 Agent MVP', 'checkpoint_630', '需求100%挂接价值初评') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'C01', '编排引擎选型部署与 MVP 联调', 'thin_core', '阶段二', w.id, 8, JSON_ARRAY('KR10.3-ENG'), '平台组', JSON_ARRAY('后端组'), '2026-04-21', '2026-05-18', 'active', 'medium', '在 control-plane 内沉淀可替换编排内核与节点执行协议。', '5/31 前编排引擎部署完成，MVP 管道联调可运行。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W2', 'checkpoint_531', '引擎部署与 MVP 联调') FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL SELECT 'C02', '事件驱动层与工具链统一 API', 'thin_core', '阶段二', w.id, 9, JSON_ARRAY('KR10.3-ENG', 'KR10.3-PIPE'), '平台组', JSON_ARRAY('后端组', '运维组'), '2026-04-28', '2026-05-20', 'active', 'medium', '统一接入 Teambition、钉钉、CI/CD、Webhook 等外部系统。', '5/31 前三组 API 可调用，事件链路打通。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W2', 'checkpoint_531', '三组 API 可调用') FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL SELECT 'C03', 'AI Agent 架构规范与参考实现', 'thin_core', '阶段二', w.id, 10, JSON_ARRAY('KR10.3-ENG'), '平台组', JSON_ARRAY('后端组'), '2026-05-05', '2026-05-25', 'active', 'medium', '统一 Agent Tool/Memory/Prompt/Error 模型并沉淀参考实现。', '5/31 前 Agent 规范定版，参考实现可运行。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W2', 'checkpoint_531', 'Agent 规范与参考实现') FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL SELECT 'C04', '节点契约 Schema + 技能包规范', 'thin_core', '阶段二', w.id, 11, JSON_ARRAY('KR10.3-ENG'), '平台组', JSON_ARRAY('后端组', '测试组'), '2026-05-05', '2026-05-25', 'active', 'medium', '统一节点输入输出 Schema、技能包元数据与模板引用规范。', '5/31 前 Schema >=3 节点，技能包 >=3，规则源统一到 ai-rules。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W2', 'checkpoint_531', 'Schema>=3，技能包>=3') FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL SELECT 'C05', '可观测审计协议 + Dashboard', 'thin_core', '阶段二', w.id, 12, JSON_ARRAY('KR10.3-ENG'), '平台组', JSON_ARRAY('后端组'), '2026-05-12', '2026-05-30', 'active', 'medium', '统一 trace、节点日志、人工审批、质量样本与审计口径。', '5/31 前可观测协议定版，Dashboard 可访问。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W2', 'checkpoint_531', 'Dashboard 可访问') FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL SELECT 'P01', '技术管道 Bug 闭环 V1.0', 'pipeline', '阶段二', w.id, 13, JSON_ARRAY('KR10.3-PIPE'), '后端组', JSON_ARRAY('测试组', '平台组'), '2026-05-18', '2026-06-15', 'active', 'medium', '事件接入、Bug 结构化、方案生成、Patch、单测、DB/沙箱验证与结果回写闭环。', '6/30 前至少 1 条真实 Bug 修复闭环跑通并归档证据。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_531', '核心 Agent 开发中', 'checkpoint_630', '真实 Bug 闭环跑通') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P02', '测试管道自动化 V1.0', 'pipeline', '阶段二', w.id, 14, JSON_ARRAY('KR10.3-PIPE'), '测试组', JSON_ARRAY('后端组', '平台组'), '2026-05-18', '2026-06-15', 'active', 'medium', '结构化 Bug 回写、用例生成、自动执行与日报通知。', '6/30 前测试管道可运行，Bug 填写与报告自动化可验收。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_531', 'Bug 填写 Agent 就绪', 'checkpoint_630', '测试报告自动化') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P03', '运维管道发布闭环 V1.0', 'pipeline', '阶段二', w.id, 15, JSON_ARRAY('KR10.3-PIPE'), '运维组', JSON_ARRAY('后端组', '平台组'), '2026-05-20', '2026-06-15', 'active', 'medium', 'CodeReview、编译/发布结果采集与发布归档闭环。', '6/30 前至少 2 条发布案例可追溯。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_531', 'CodeReview Agent 就绪', 'checkpoint_630', '发布案例>=2') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P04', '项管管道任务闭环 V1.0', 'pipeline', '阶段二', w.id, 16, JSON_ARRAY('KR10.3-PIPE'), '项管组', JSON_ARRAY('平台组'), '2026-05-20', '2026-06-15', 'active', 'medium', '任务拆分、每日提醒、延期预警与钉钉通知闭环。', '6/30 前任务闭环可运行，提醒通知可验证。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_531', '任务拆分 Agent 就绪', 'checkpoint_630', '钉钉通知可验证') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P06', 'RAG 向量化知识库 V1.0', 'pipeline', '阶段二', w.id, 17, JSON_ARRAY('KR10.3-PIPE'), '平台组', JSON_ARRAY('各组'), '2026-05-18', '2026-06-20', 'active', 'medium', '核心工程产物向量化入库，并在至少 1 个节点执行时自动注入上下文。', '6/30 前知识库 API 可用，至少 1 个节点深度集成 RAG。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_630', '知识库 API 可用，RAG 深度集成>=1 节点') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P07', 'CI/CD 门禁与代码质量治理', 'pipeline', '阶段二', w.id, 18, JSON_ARRAY('KR10.2'), '平台+后端', JSON_ARRAY('产品组', '测试组', '运维组'), '2026-05-20', '2026-06-20', 'active', 'high', '统一文档门禁、代码门禁和 CI/CD 通知/警告/阻断策略。', '6/30 前新老项目均接入统一门禁策略并稳定运行。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_630', '新老项目接入统一门禁策略') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'P08', '研发 AI 编码 + 设计可消费交付', 'pipeline', '阶段二', w.id, 19, JSON_ARRAY('KR10.3'), '后端+设计', JSON_ARRAY('前端组', '移动端组', '产品组', '测试组'), '2026-05-01', '2026-06-20', 'active', 'medium', '统计 AI 生成占比、采纳率、返工率，并沉淀设计可消费交付模板。', '6/30 前 AI 生成占比和采纳率达标，返工率低于 20%。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W3', 'checkpoint_531', '数据采集启动', 'checkpoint_630', '占比/采纳率/返工率达标') FROM gateway_waves w WHERE w.code = 'W3'
  UNION ALL SELECT 'G01', '新项目全链路闭环验证', 'governance', '阶段二', w.id, 20, JSON_ARRAY('KR10.4'), '平台组', JSON_ARRAY('全部组'), '2026-06-15', '2026-06-30', 'active', 'medium', '选取新项目完成从需求到验收的全链路 AI 化样板验证。', '6/30 前新项目全链路跑通，证据齐全。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W4', 'checkpoint_630', '新项目全链路跑通') FROM gateway_waves w WHERE w.code = 'W4'
  UNION ALL SELECT 'G02', '老项目全链路闭环验证', 'governance', '阶段二', w.id, 21, JSON_ARRAY('KR10.4'), '平台组', JSON_ARRAY('全部组'), '2026-06-15', '2026-06-30', 'active', 'medium', '选取老项目验证统一门禁与流程迁移的可行性，输出差距清单。', '6/30 前老项目同标准验证完成并输出整改清单。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W4', 'checkpoint_630', '老项目差距清单') FROM gateway_waves w WHERE w.code = 'W4'
  UNION ALL SELECT 'G04', '复盘 + AI 型项管流程 + Q3 准备', 'governance', '阶段二', w.id, 22, JSON_ARRAY('KR10.4'), '项管+技术总监', JSON_ARRAY('全部组'), '2026-06-01', '2026-06-30', 'active', 'low', '沉淀阶段复盘、AI 型项目管理流程 V1.0 与下一阶段建议。', '6/30 前复盘定稿，AI 型项管流程 V1.0 可导出。', JSON_OBJECT('legacy_catalog', false, 'official_wave', 'W4', 'checkpoint_630', '复盘定稿与 AI 型项管流程') FROM gateway_waves w WHERE w.code = 'W4'
) AS seeded
ON DUPLICATE KEY UPDATE
`name` = VALUES(`name`),
`layer` = VALUES(`layer`),
`okr_stage` = VALUES(`okr_stage`),
`wave_id` = VALUES(`wave_id`),
`official_order` = VALUES(`official_order`),
`okr_refs` = VALUES(`okr_refs`),
`owner_role` = VALUES(`owner_role`),
`co_owner_roles` = VALUES(`co_owner_roles`),
`start_date` = VALUES(`start_date`),
`end_date` = VALUES(`end_date`),
`status` = VALUES(`status`),
`risk_level` = VALUES(`risk_level`),
`summary` = VALUES(`summary`),
`acceptance_rule` = VALUES(`acceptance_rule`),
`metadata_json` = VALUES(`metadata_json`);

DELETE FROM `gateway_project_milestones`
WHERE `project_code` IN (
  'F01', 'F02', 'F03', 'F04', 'F05',
  'G03', 'P05',
  'C01', 'C02', 'C03', 'C04', 'C05',
  'P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P08',
  'G01', 'G02', 'G04'
)
  AND `milestone_type` IN ('4_30_gate', '5_31_check', '6_30_acceptance');

INSERT INTO `gateway_project_milestones`
(`project_code`, `milestone_type`, `checkpoint_label`, `title`, `due_date`, `acceptance_rule`, `status`, `metadata_json`)
VALUES
('F01', '4_30_gate', '4/30', '4/30 网关上线与全员接入', '2026-04-30', '网关生产可用，接入率 100%。', 'pending', JSON_OBJECT('official', true)),
('F02', '4_30_gate', '4/30', '4/30 ai-rules 与 AI 工作手册 V1.0', '2026-04-30', 'ai-rules 仓库上线，PM/RD/QA 手册定版。', 'pending', JSON_OBJECT('official', true)),
('F03', '4_30_gate', '4/30', '4/30 企业知识覆盖率验收', '2026-04-30', '知识库覆盖率达到 70% 以上。', 'pending', JSON_OBJECT('official', true)),
('F04', '4_30_gate', '4/30', '4/30 各组规范与单点闭环', '2026-04-30', '规范定版、闭环样板>=1；测试接口/UI 各 >=1 场景。', 'pending', JSON_OBJECT('official', true)),
('F05', '4_30_gate', '4/30', '4/30 度量口径与基线采集', '2026-04-30', '度量口径定版，历史基线采集完成。', 'pending', JSON_OBJECT('official', true)),
('G03', '4_30_gate', '4/30', '4/30 认证标准与绩效方案发布', '2026-04-30', '认证标准与 AI 权重方案可查。', 'pending', JSON_OBJECT('official', true)),
('P05', '4_30_gate', '4/30', '4/30 价值口径 V1.0', '2026-04-30', '价值衡量数据口径 V1.0 完成会签。', 'pending', JSON_OBJECT('official', true)),
('C01', '5_31_check', '5/31', '5/31 编排引擎部署与 MVP 联调', '2026-05-31', '引擎部署完成，MVP 管道联调可运行。', 'pending', JSON_OBJECT('official', true)),
('C02', '5_31_check', '5/31', '5/31 工具链 API 与事件链路', '2026-05-31', 'Teambition/钉钉/CI-CD API 可调用，事件链路打通。', 'pending', JSON_OBJECT('official', true)),
('C03', '5_31_check', '5/31', '5/31 Agent 规范与参考实现', '2026-05-31', 'Agent 规范定版，参考实现可运行。', 'pending', JSON_OBJECT('official', true)),
('C04', '5_31_check', '5/31', '5/31 Schema 与技能包规范', '2026-05-31', 'Schema >=3 节点，技能包 >=3。', 'pending', JSON_OBJECT('official', true)),
('C05', '5_31_check', '5/31', '5/31 可观测 Dashboard', '2026-05-31', '可观测协议定版，Dashboard 可访问。', 'pending', JSON_OBJECT('official', true)),
('F05', '5_31_check', '5/31', '5/31 度量仪表盘上线', '2026-05-31', '基础仪表盘稳定可访问。', 'pending', JSON_OBJECT('official', true)),
('P01', '5_31_check', '5/31', '5/31 技术管道核心 Agent 开发中', '2026-05-31', 'Bug 管道设计完成，核心节点已进入开发。', 'pending', JSON_OBJECT('official', true)),
('P02', '5_31_check', '5/31', '5/31 测试管道 Bug 填写 Agent', '2026-05-31', 'Bug 填写 Agent 可运行并生成结构化字段。', 'pending', JSON_OBJECT('official', true)),
('P03', '5_31_check', '5/31', '5/31 CodeReview Agent', '2026-05-31', 'CodeReview 报告可生成并归档。', 'pending', JSON_OBJECT('official', true)),
('P04', '5_31_check', '5/31', '5/31 任务拆分 Agent', '2026-05-31', '任务拆分 Agent 可输出结构化任务列表。', 'pending', JSON_OBJECT('official', true)),
('P05', '5_31_check', '5/31', '5/31 价值初评 Agent MVP', '2026-05-31', '价值初评 Agent 已产生首批记录。', 'pending', JSON_OBJECT('official', true)),
('P08', '5_31_check', '5/31', '5/31 AI 编码/设计采集启动', '2026-05-31', '占比/采纳率/返工率数据采集已启动。', 'pending', JSON_OBJECT('official', true)),
('F01', '6_30_acceptance', '6/30', '6/30 F01 终验', '2026-06-30', '网关稳定运行并持续服务 ThinCore 与管道。', 'pending', JSON_OBJECT('official', true)),
('F02', '6_30_acceptance', '6/30', '6/30 F02 终验', '2026-06-30', 'ai-rules 成为唯一规则源，工作手册可消费。', 'pending', JSON_OBJECT('official', true)),
('F03', '6_30_acceptance', '6/30', '6/30 F03 终验', '2026-06-30', '知识资产可供 RAG 检索并持续维护。', 'pending', JSON_OBJECT('official', true)),
('F04', '6_30_acceptance', '6/30', '6/30 F04 终验', '2026-06-30', '各组规范继续被门禁与管道消费。', 'pending', JSON_OBJECT('official', true)),
('F05', '6_30_acceptance', '6/30', '6/30 F05 终验', '2026-06-30', '度量体系支撑 G03 提效报告。', 'pending', JSON_OBJECT('official', true)),
('G03', '6_30_acceptance', '6/30', '6/30 G03 终验', '2026-06-30', '首轮认证完成并输出 AI 专项提效分析报告。', 'pending', JSON_OBJECT('official', true)),
('P05', '6_30_acceptance', '6/30', '6/30 P05 终验', '2026-06-30', '进入开发需求 100% 挂接价值初评。', 'pending', JSON_OBJECT('official', true)),
('C01', '6_30_acceptance', '6/30', '6/30 C01 终验', '2026-06-30', '编排内核可稳定支撑五大模板与审批节点。', 'pending', JSON_OBJECT('official', true)),
('C02', '6_30_acceptance', '6/30', '6/30 C02 终验', '2026-06-30', '统一集成 API 可用，外部系统接入可维护。', 'pending', JSON_OBJECT('official', true)),
('C03', '6_30_acceptance', '6/30', '6/30 C03 终验', '2026-06-30', 'Agent 规范被 Harness 节点执行器和模板消费。', 'pending', JSON_OBJECT('official', true)),
('C04', '6_30_acceptance', '6/30', '6/30 C04 终验', '2026-06-30', 'Schema、技能包与模板引用统一落地。', 'pending', JSON_OBJECT('official', true)),
('C05', '6_30_acceptance', '6/30', '6/30 C05 终验', '2026-06-30', 'Trace、节点日志、审批和审计可追溯。', 'pending', JSON_OBJECT('official', true)),
('P01', '6_30_acceptance', '6/30', '6/30 P01 终验', '2026-06-30', '至少 1 条真实 Bug 闭环跑通并输出证据包。', 'pending', JSON_OBJECT('official', true)),
('P02', '6_30_acceptance', '6/30', '6/30 P02 终验', '2026-06-30', '测试管道可运行并自动输出报告。', 'pending', JSON_OBJECT('official', true)),
('P03', '6_30_acceptance', '6/30', '6/30 P03 终验', '2026-06-30', '运维发布闭环可运行并至少覆盖 2 条案例。', 'pending', JSON_OBJECT('official', true)),
('P04', '6_30_acceptance', '6/30', '6/30 P04 终验', '2026-06-30', '项管任务闭环可运行并可验证通知效果。', 'pending', JSON_OBJECT('official', true)),
('P06', '6_30_acceptance', '6/30', '6/30 P06 终验', '2026-06-30', '知识库 API 可用，>=1 节点深度集成 RAG。', 'pending', JSON_OBJECT('official', true)),
('P07', '6_30_acceptance', '6/30', '6/30 P07 终验', '2026-06-30', '新老项目接入统一门禁策略并稳定运行。', 'pending', JSON_OBJECT('official', true)),
('P08', '6_30_acceptance', '6/30', '6/30 P08 终验', '2026-06-30', 'AI 生成占比、采纳率和返工率达到目标。', 'pending', JSON_OBJECT('official', true)),
('G01', '6_30_acceptance', '6/30', '6/30 G01 终验', '2026-06-30', '新项目全链路闭环验证通过。', 'pending', JSON_OBJECT('official', true)),
('G02', '6_30_acceptance', '6/30', '6/30 G02 终验', '2026-06-30', '老项目全链路验证完成并输出差距清单。', 'pending', JSON_OBJECT('official', true)),
('G04', '6_30_acceptance', '6/30', '6/30 G04 终验', '2026-06-30', '复盘定稿，AI 型项目管理流程 V1.0 可导出。', 'pending', JSON_OBJECT('official', true));

INSERT INTO `gateway_agent_specs`
(`agent_key`, `name`, `purpose`, `tool_bindings`, `memory_policy`, `prompt_ref`, `error_policy`, `runtime_env`, `status`)
VALUES
('gate-review-agent', '门禁评审 Agent', '执行统一门禁评审链路并归档结果。', JSON_ARRAY('gate-engine', 'ai-gateway', 'control-plane'), JSON_OBJECT('mode', 'stateless'), 'ai-rules/prompts/gate-review-agent.md', JSON_OBJECT('mode', 'manual_escalation'), JSON_OBJECT('service', 'control-plane'), 'active'),
('harness-node-executor', 'Harness 节点执行器', '作为 ThinCore 默认节点执行器，兼容 patch、RAG 注入与审批上下文。', JSON_ARRAY('control-plane', 'ai-gateway', 'knowledge-base'), JSON_OBJECT('mode', 'ephemeral'), 'ai-rules/prompts/harness-node-executor.md', JSON_OBJECT('mode', 'checkpoint_retry'), JSON_OBJECT('service', 'control-plane'), 'active'),
('value-assessment-agent', '价值初评 Agent', '生成需求价值结构化记录并等待产品拍板。', JSON_ARRAY('control-plane', 'knowledge-base'), JSON_OBJECT('mode', 'stateless'), 'ai-rules/prompts/value-assessment-agent.md', JSON_OBJECT('mode', 'manual_confirmation'), JSON_OBJECT('service', 'control-plane'), 'active')
ON DUPLICATE KEY UPDATE
`name` = VALUES(`name`),
`purpose` = VALUES(`purpose`),
`tool_bindings` = VALUES(`tool_bindings`),
`memory_policy` = VALUES(`memory_policy`),
`prompt_ref` = VALUES(`prompt_ref`),
`error_policy` = VALUES(`error_policy`),
`runtime_env` = VALUES(`runtime_env`),
`status` = VALUES(`status`);

INSERT INTO `gateway_contract_schemas`
(`schema_key`, `domain`, `schema_name`, `version`, `json_schema`, `sample_payload`, `validation_mode`, `status`)
VALUES
('gate-execution-sync', 'gate', '门禁执行同步协议', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('gate_name', 'gate_type', 'trace_id')), JSON_OBJECT('gate_name', '技术方案门禁', 'gate_type', 'tech', 'trace_id', 'trace-demo-001'), 'strict', 'active'),
('prd_input', 'product', 'PRD 输入契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'artifact_type', 'content_text')), JSON_OBJECT('bundle_id', 1, 'artifact_type', 'prd', 'content_text', '# PRD'), 'strict', 'active'),
('prd_output', 'product', 'PRD 输出契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('artifact_type', 'title', 'content_text')), JSON_OBJECT('artifact_type', 'prd', 'title', '销售订单 PRD', 'content_text', '# PRD'), 'strict', 'active'),
('tech_spec_input', 'design', '技术方案输入契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'artifact_type', 'content_text')), JSON_OBJECT('bundle_id', 1, 'artifact_type', 'tech_spec', 'content_text', '# 技术方案'), 'strict', 'active'),
('tech_spec_output', 'design', '技术方案输出契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('artifact_type', 'title', 'content_text')), JSON_OBJECT('artifact_type', 'tech_spec', 'title', '销售订单技术方案', 'content_text', '# 技术方案'), 'strict', 'active'),
('test_plan_input', 'test', '测试方案输入契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'coverage_graph_run_id')), JSON_OBJECT('bundle_id', 1, 'coverage_graph_run_id', 2), 'strict', 'active'),
('doc_gate_output', 'gate', '文档门禁统一输出契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('status', 'summary', 'checks', 'citations', 'evaluator_meta')), JSON_OBJECT('status', 'warn', 'summary', '缺 Coverage obligation', 'checks', JSON_ARRAY(), 'citations', JSON_ARRAY(), 'evaluator_meta', JSON_OBJECT()), 'strict', 'active'),
('pipeline_node_input', 'runtime', '通用节点输入契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('trace_id', 'project_code', 'node_input')), JSON_OBJECT('trace_id', 'trace-demo', 'project_code', 'P01', 'node_input', JSON_OBJECT('ticket_id', 'BUG-1')), 'strict', 'active'),
('pipeline_node_output', 'runtime', '通用节点输出契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('status', 'summary')), JSON_OBJECT('status', 'completed', 'summary', '节点执行完成'), 'strict', 'active'),
('value_assessment_record', 'product', '价值初评记录契约', '1.0.0', JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('demand_title', 'assessment_score', 'confirm_owner')), JSON_OBJECT('demand_title', '销售订单优化', 'assessment_score', 78, 'confirm_owner', '产品负责人'), 'strict', 'active')
ON DUPLICATE KEY UPDATE
`json_schema` = VALUES(`json_schema`),
`sample_payload` = VALUES(`sample_payload`),
`validation_mode` = VALUES(`validation_mode`),
`status` = VALUES(`status`);

INSERT INTO `gateway_skill_packages`
(`skill_key`, `name`, `version`, `env_tags`, `input_decl`, `output_decl`, `prompt_ref`, `tool_refs`, `status`)
VALUES
('evidence-archive', '证据归档技能包', '1.0.0', JSON_ARRAY('q2', 'gate-review'), JSON_OBJECT('trace_id', 'string', 'project_code', 'string'), JSON_OBJECT('evidence_pack_id', 'number'), 'ai-rules/skills/evidence-archive.md', JSON_ARRAY('control-plane', 'ai-gateway'), 'active'),
('prd_gate_review', 'PRD 门禁评审技能包', '1.0.0', JSON_ARRAY('phase1', 'prd'), JSON_OBJECT('artifact_type', 'prd'), JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array'), 'ai-rules/skills/prd-gate-review.md', JSON_ARRAY('control-plane', 'knowledge-base'), 'active'),
('tech_spec_gate_review', '技术方案门禁评审技能包', '1.0.0', JSON_ARRAY('phase1', 'tech_spec'), JSON_OBJECT('artifact_type', 'tech_spec'), JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array'), 'ai-rules/skills/tech-spec-gate-review.md', JSON_ARRAY('control-plane', 'knowledge-base'), 'active'),
('test_plan_generate', '测试方案生成技能包', '1.0.0', JSON_ARRAY('phase1', 'test_plan'), JSON_OBJECT('artifact_type', 'test_plan_draft'), JSON_OBJECT('artifact_type', 'test_plan_draft'), 'ai-rules/skills/test-plan-generate.md', JSON_ARRAY('control-plane'), 'active'),
('test_plan_gate_review', '测试方案门禁评审技能包', '1.0.0', JSON_ARRAY('phase1', 'test_plan_gate'), JSON_OBJECT('artifact_type', 'test_plan_final'), JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array'), 'ai-rules/skills/test-plan-gate-review.md', JSON_ARRAY('control-plane', 'knowledge-base'), 'active'),
('deepwiki_diagram_synthesis', 'Deep Wiki 结构化 Mermaid 制图', '1.0.0', JSON_ARRAY('deepwiki', 'diagram'), JSON_OBJECT('inventory', 'object', 'module_digests', 'array'), JSON_OBJECT('system_architecture', 'string', 'product_architecture', 'string', 'core_flow', 'string', 'sequence', 'string', 'er_diagram', 'string'), 'ai-rules/skills/deepwiki-diagram-synthesis.md', JSON_ARRAY('control-plane', 'ai-gateway'), 'active'),
('deepwiki_module_context', 'Deep Wiki 模块叙事补充（占位）', '1.0.0', JSON_ARRAY('deepwiki', 'module'), JSON_OBJECT('module_name', 'string'), JSON_OBJECT('hints', 'string'), 'ai-rules/skills/deepwiki-module-context.md', JSON_ARRAY('control-plane'), 'active'),
('p01_bug_analysis', 'P01 Bug 分析与方案生成', '1.0.0', JSON_ARRAY('pipeline', 'p01'), JSON_OBJECT('bug_ticket', 'object', 'retrieval_context', 'array'), JSON_OBJECT('solution_summary', 'string', 'risk_notes', 'array'), 'ai-rules/skills/p01-bug-analysis.md', JSON_ARRAY('control-plane', 'knowledge-base'), 'active'),
('p01_patch_apply', 'P01 Patch 建议与应用', '1.0.0', JSON_ARRAY('pipeline', 'p01'), JSON_OBJECT('target_repo', 'string', 'solution_summary', 'string'), JSON_OBJECT('changed_files', 'array', 'patch_mode', 'string'), 'ai-rules/skills/p01-patch-apply.md', JSON_ARRAY('control-plane'), 'active'),
('p05_value_assessment', 'P05 价值初评记录', '1.0.0', JSON_ARRAY('pipeline', 'p05'), JSON_OBJECT('demand_title', 'string', 'historical_cases', 'array'), JSON_OBJECT('assessment_score', 'number', 'confirm_owner', 'string'), 'ai-rules/skills/p05-value-assessment.md', JSON_ARRAY('control-plane', 'knowledge-base'), 'active')
ON DUPLICATE KEY UPDATE
`env_tags` = VALUES(`env_tags`),
`input_decl` = VALUES(`input_decl`),
`output_decl` = VALUES(`output_decl`),
`prompt_ref` = VALUES(`prompt_ref`),
`tool_refs` = VALUES(`tool_refs`),
`status` = VALUES(`status`);

INSERT INTO `gateway_pipeline_definitions`
(`pipeline_key`, `name`, `domain`, `description`, `template_ref`, `owner_role`, `status`)
VALUES
('gate-review', '统一门禁评审链路', 'gate', 'PRD/技术方案/测试方案/代码门禁的统一评审与证据归档模板。', 'ai-rules/pipelines/gate-review.json', '平台组', 'active'),
('doc-pipeline-v1', '文档工程化标准管道', 'engineering', '上传 PRD、技术方案、接口契约、DDL 后执行文档门禁、Coverage Graph 与测试方案双轨生成。', 'ai-rules/pipelines/doc-pipeline-v1.json', '平台组', 'active'),
('p01-tech-bug-loop-v1', 'P01 技术管道 Bug 闭环 V1.0', 'engineering', '事件接入 -> Bug 结构化 -> 方案生成 -> 人工确认 -> Patch -> 单测 -> DB/沙箱验证 -> 回写 -> 证据归档。', 'ai-rules/pipelines/p01-tech-bug-loop-v1.json', '后端组', 'active'),
('p02-test-automation-v1', 'P02 测试管道自动化 V1.0', 'test', '结构化 Bug 回写、用例生成、自动执行、结果聚合与日报通知。', 'ai-rules/pipelines/p02-test-automation-v1.json', '测试组', 'active'),
('p03-ops-release-closure-v1', 'P03 运维管道发布闭环 V1.0', 'ops', '发布事件接入、CodeReview、编译/发布结果采集、回滚检查与归档。', 'ai-rules/pipelines/p03-ops-release-closure-v1.json', '运维组', 'active'),
('p04-pm-task-closure-v1', 'P04 项管管道任务闭环 V1.0', 'pm', '任务拆分、每日提醒、延期预警与通知归档。', 'ai-rules/pipelines/p04-pm-task-closure-v1.json', '项管组', 'active'),
('p05-product-value-evaluation-v1', 'P05 产品管道价值初评 V1.0', 'product', '需求结构化抽取、历史检索、价值初评、产品确认与留痕归档。', 'ai-rules/pipelines/p05-product-value-evaluation-v1.json', '产品组', 'active')
ON DUPLICATE KEY UPDATE
`name` = VALUES(`name`),
`domain` = VALUES(`domain`),
`description` = VALUES(`description`),
`template_ref` = VALUES(`template_ref`),
`owner_role` = VALUES(`owner_role`),
`status` = VALUES(`status`);

INSERT INTO `gateway_pipeline_versions`
(`pipeline_definition_id`, `version`, `status`, `published_at`, `change_summary`)
SELECT d.id, '1.0.0', 'published', NOW(), 'Q2 官方模板初始化'
FROM `gateway_pipeline_definitions` d
WHERE d.pipeline_key IN (
  'gate-review',
  'doc-pipeline-v1',
  'p01-tech-bug-loop-v1',
  'p02-test-automation-v1',
  'p03-ops-release-closure-v1',
  'p04-pm-task-closure-v1',
  'p05-product-value-evaluation-v1'
)
ON DUPLICATE KEY UPDATE
`status` = VALUES(`status`),
`published_at` = VALUES(`published_at`),
`change_summary` = VALUES(`change_summary`);

UPDATE `gateway_pipeline_definitions` d
SET
  d.current_version_id = (
    SELECT v.id
    FROM `gateway_pipeline_versions` v
    WHERE v.pipeline_definition_id = d.id AND v.version = '1.0.0'
    LIMIT 1
  ),
  d.status = 'active'
WHERE d.pipeline_key IN (
  'gate-review',
  'doc-pipeline-v1',
  'p01-tech-bug-loop-v1',
  'p02-test-automation-v1',
  'p03-ops-release-closure-v1',
  'p04-pm-task-closure-v1',
  'p05-product-value-evaluation-v1'
);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'rule_bind', '规则绑定', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 1, JSON_OBJECT('template_stage', 'binding')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'gate-review' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `node_name` = VALUES(`node_name`), `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'gate_execute', '门禁执行', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('template_stage', 'execution')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'gate-review' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `node_name` = VALUES(`node_name`), `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'approval_or_override', '人工审批/Override', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 3, JSON_OBJECT('approver_role', '项目管理组')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'gate-review' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `node_name` = VALUES(`node_name`), `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '证据归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 4, JSON_OBJECT('pack_type', 'gate_review')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'gate-review' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `node_name` = VALUES(`node_name`), `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'input_contract', '输入契约', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('bundle_artifacts', JSON_ARRAY('prd', 'tech_spec', 'api_contract', 'ddl'))
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'prd_gate', 'PRD 门禁', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 45000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('skill_key', 'prd_gate_review')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'repo_context_build', '仓库上下文构建', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'continue'), 3, JSON_OBJECT('uses_repo_inventory', true)
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'tech_spec_generate', '生成技术方案', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'manual_review'), 4, JSON_OBJECT('output_artifact', 'tech_spec')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'tech_spec_gate', '技术方案门禁', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 45000), JSON_OBJECT('mode', 'manual_review'), 5, JSON_OBJECT('skill_key', 'tech_spec_gate_review')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'coverage_graph', 'Coverage Graph', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 6, JSON_OBJECT('graph_type', 'coverage')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'test_plan_generate', '生成双轨草稿', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'continue'), 7, JSON_OBJECT('skill_key', 'test_plan_generate')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'test_plan_gate', '测试方案门禁', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 45000), JSON_OBJECT('mode', 'manual_review'), 8, JSON_OBJECT('skill_key', 'test_plan_gate_review')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'publish', '发布正式版', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 9, JSON_OBJECT('approver_role', '测试组')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'doc-pipeline-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'event_ingest', '事件接入', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('source', 'teambition_bug_webhook')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'bug_structured_parse', 'Bug 结构化读取', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('skill_key', 'p01_bug_analysis', 'uses_rag', true)
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'solution_generate', '修复方案生成', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'manual_review'), 3, JSON_OBJECT('skill_key', 'p01_bug_analysis')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'human_confirm', '人工确认', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 4, JSON_OBJECT('approver_role', '后端组负责人')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'patch_apply', 'Patch 建议/应用', 'callback', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 120000), JSON_OBJECT('mode', 'manual_review'), 5, JSON_OBJECT('skill_key', 'p01_patch_apply', 'executor', 'harness-node-executor')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'unit_test', '单元测试', 'gate', JSON_OBJECT('maxRetries', 3), JSON_OBJECT('timeoutMs', 300000), JSON_OBJECT('mode', 'manual_review'), 6, JSON_OBJECT('policy', 'must_pass')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'db_sandbox_validate', 'DB/沙箱验证', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 180000), JSON_OBJECT('mode', 'manual_review'), 7, JSON_OBJECT('policy', 'sandbox_first')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'tb_writeback', '结果回写', 'callback', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 8, JSON_OBJECT('connection_key', 'teambition_primary')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '证据归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 9, JSON_OBJECT('pack_type', 'p01_bug_loop')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p01-tech-bug-loop-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'bug_ingest', 'Bug 接入', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('source', 'teambition_bug_webhook')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'bug_fill_agent', '结构化 Bug 回写', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('report_key', 'bug_fill')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'case_generate', '用例生成', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'continue'), 3, JSON_OBJECT('output', 'test_cases')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'test_execute', '自动执行', 'gate', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 300000), JSON_OBJECT('mode', 'manual_review'), 4, JSON_OBJECT('run_type', 'api_ui_mix')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'daily_report', '日报推送', 'callback', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 5, JSON_OBJECT('connection_key', 'dingtalk_robot')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '证据归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 6, JSON_OBJECT('pack_type', 'p02_test')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p02-test-automation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'release_request_ingest', '发布事件接入', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('source', 'cicd_primary')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'code_review_generate', 'CodeReview 报告', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('report_type', 'code_review')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'build_collect', '编译结果采集', 'gate', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 180000), JSON_OBJECT('mode', 'manual_review'), 3, JSON_OBJECT('check', 'build_status')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'release_verify', '发布结果校验', 'gate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 180000), JSON_OBJECT('mode', 'manual_review'), 4, JSON_OBJECT('check', 'publish_status')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'rollback_check', '回滚检查', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 5, JSON_OBJECT('approver_role', '运维值班')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '证据归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 6, JSON_OBJECT('pack_type', 'p03_release')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p03-ops-release-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'demand_ingest', '任务接入', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('source', 'dingtalk_robot')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'task_split', '任务拆分', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('output', 'task_list')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'owner_confirm', '负责人确认', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 3, JSON_OBJECT('approver_role', '项目负责人')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'daily_reminder', '每日提醒', 'callback', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 4, JSON_OBJECT('connection_key', 'dingtalk_robot')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'risk_escalate', '延期预警', 'callback', JSON_OBJECT('maxRetries', 2), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 5, JSON_OBJECT('severity', 'warn')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '状态归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 6, JSON_OBJECT('pack_type', 'p04_pm')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p04-pm-task-closure-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'demand_ingest', '需求接入', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'block'), 1, JSON_OBJECT('source', 'teambition_primary')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'feature_extract', '特征提取', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 60000), JSON_OBJECT('mode', 'manual_review'), 2, JSON_OBJECT('output', 'value_features')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'historical_retrieve', '历史检索', 'transform', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 45000), JSON_OBJECT('mode', 'continue'), 3, JSON_OBJECT('uses_rag', true)
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'value_assessment', '价值初评', 'generate', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 90000), JSON_OBJECT('mode', 'manual_review'), 4, JSON_OBJECT('skill_key', 'p05_value_assessment')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'product_confirm', '产品确认拍板', 'approval', JSON_OBJECT('maxRetries', 0), JSON_OBJECT('timeoutMs', 86400000), JSON_OBJECT('mode', 'block'), 5, JSON_OBJECT('approver_role', '产品负责人')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);
INSERT INTO `gateway_pipeline_nodes`
(`pipeline_version_id`, `node_key`, `node_name`, `node_type`, `retry_policy`, `timeout_policy`, `fallback_policy`, `sort_order`, `config_json`)
SELECT v.id, 'evidence_archive', '价值记录归档', 'callback', JSON_OBJECT('maxRetries', 1), JSON_OBJECT('timeoutMs', 30000), JSON_OBJECT('mode', 'continue'), 6, JSON_OBJECT('pack_type', 'p05_value')
FROM `gateway_pipeline_versions` v
JOIN `gateway_pipeline_definitions` d ON d.id = v.pipeline_definition_id
WHERE d.pipeline_key = 'p05-product-value-evaluation-v1' AND v.version = '1.0.0'
ON DUPLICATE KEY UPDATE `config_json` = VALUES(`config_json`);

INSERT INTO `gateway_integration_connections`
(`connection_key`, `name`, `category`, `endpoint_url`, `auth_mode`, `owner_role`, `status`, `metadata_json`)
VALUES
('teambition_primary', 'Teambition 主连接', 'project_mgmt', 'https://open.teambition.example/api', 'token', '平台组', 'planned', JSON_OBJECT('official_scope', JSON_ARRAY('P01', 'P02', 'P05'))),
('dingtalk_robot', '钉钉通知机器人', 'messaging', 'https://oapi.dingtalk.com/robot/send', 'robot_secret', '平台组', 'planned', JSON_OBJECT('official_scope', JSON_ARRAY('P02', 'P04'))),
('cicd_primary', 'CI/CD 主连接', 'cicd', 'https://cicd.example.internal/api', 'service_account', '平台组', 'planned', JSON_OBJECT('official_scope', JSON_ARRAY('P03', 'P07'))),
('deepwiki_git_webhook', 'Deep Wiki Git Webhook', 'webhook', '/api/v1/deepwiki/webhooks/git', 'shared_secret', '平台组', 'active', JSON_OBJECT('official_scope', JSON_ARRAY('F03', 'P06')))
ON DUPLICATE KEY UPDATE
`name` = VALUES(`name`),
`category` = VALUES(`category`),
`endpoint_url` = VALUES(`endpoint_url`),
`auth_mode` = VALUES(`auth_mode`),
`owner_role` = VALUES(`owner_role`),
`status` = VALUES(`status`),
`metadata_json` = VALUES(`metadata_json`);

INSERT INTO `gateway_value_assessments`
(`project_code`, `assessment_key`, `demand_title`, `value_summary`, `assessment_status`, `assessment_score`, `confirm_owner`, `confirm_time`, `metadata_json`)
VALUES
('P05', 'value-eval-template-v1', '销售订单需求价值衡量模板', '初始化一条价值初评样板，用于挂接产品确认和后续回写。', 'draft', 76.00, NULL, NULL, JSON_OBJECT('official_seed', true, 'pipeline_template', 'p05-product-value-evaluation-v1'))
ON DUPLICATE KEY UPDATE
`demand_title` = VALUES(`demand_title`),
`value_summary` = VALUES(`value_summary`),
`assessment_status` = VALUES(`assessment_status`),
`assessment_score` = VALUES(`assessment_score`),
`confirm_owner` = VALUES(`confirm_owner`),
`confirm_time` = VALUES(`confirm_time`),
`metadata_json` = VALUES(`metadata_json`);

INSERT INTO `gateway_certification_records`
(`project_code`, `record_type`, `subject_name`, `owner_role`, `assessment_result`, `score`, `effective_date`, `report_uri`, `metadata_json`)
VALUES
('G03', 'certification_plan', 'Q2 AI 能力认证首轮', '技术总监+项管', 'planned', NULL, '2026-06-20', NULL, JSON_OBJECT('official_seed', true, 'phase_gate', '4/30->6/30'))
ON DUPLICATE KEY UPDATE
`owner_role` = VALUES(`owner_role`),
`assessment_result` = VALUES(`assessment_result`),
`score` = VALUES(`score`),
`effective_date` = VALUES(`effective_date`),
`report_uri` = VALUES(`report_uri`),
`metadata_json` = VALUES(`metadata_json`);
