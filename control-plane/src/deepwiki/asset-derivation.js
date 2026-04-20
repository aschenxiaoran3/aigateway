const { normalizeRepoRole } = require('./types/common');
const { rankEvidence } = require('./skills/evidence-ranker');
const { hasTestPollution } = require('./gates/test-pollution');
const { isPublishedSnapshot } = require('./snapshot-state-machine');

function normalizeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function uniqueBy(items, selector) {
  const list = [];
  const seen = new Set();
  for (const item of toArray(items)) {
    const key = selector(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(item);
  }
  return list;
}

function uniqueStrings(items) {
  return uniqueBy(
    toArray(items).map((item) => normalizeText(item)).filter(Boolean),
    (item) => item.toLowerCase()
  );
}

function kebabCase(value) {
  return normalizeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function titleFromToken(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/[\u4e00-\u9fa5]/.test(text)) return text;
  return text
    .split(/[_\-/\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function splitSemanticTokens(value) {
  return normalizeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
}

function isTechnicalLabel(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /(controller|service|repository|mapper|dto|entity|rpc|feign|impl|handler)/i.test(text) && !/[\u4e00-\u9fa5]/.test(text);
}

function isWeakCapabilityLabel(value) {
  const text = normalizeText(value);
  if (!text) return true;
  if (isTechnicalLabel(text)) return true;
  if (/^[A-Za-z0-9 _-]+操作$/i.test(text)) return true;
  if (/^(bank操作|index操作|detail操作|edit\s*form操作|change\s*status操作)$/i.test(text)) return true;
  if (/^(downloadexceltemplate|fetch导入types|fetch导入statuses|userlist|billeditordialog|dialog|drawer|panelgroup)$/i.test(text.replace(/\s+/g, ''))) {
    return true;
  }
  if (/^(fetch|get|download|change|edit|add|index|detail|list)[A-Z_]/.test(text)) {
    return true;
  }
  if (/(userlist|barchart|linechart|piechart|chart|dialog|drawer|button|toolbar|modal|popover|grid|datatable|tablecolumn|tabpane|tabs|widget|component|panel|optimized|resize|notfound|unauthorized|forbidden|404|401|500|error)/i.test(text)) {
    return true;
  }
  const compact = text.replace(/\s+/g, '');
  return /^(列表|图表|表单|按钮|弹窗|面板|组件|页面)(操作|处理)?$/.test(compact);
}

const DOMAIN_KEYWORD_CATALOG = [
  { key: 'order', name: '订单域', keywords: ['order', 'orders', '订单', 'submit', 'cancel'] },
  { key: 'ai_ordering', name: 'AI 协同 / 智能编排', keywords: ['ai', 'chat', 'session', 'stream', 'feedback', 'knowledge', 'prompt', 'submitbill', 'syncbillpreview'] },
  { key: 'finance_bill', name: '财务单据 / 结算', keywords: ['finance', 'fee', 'income', 'settlement', 'bank', 'payable', 'receivable'] },
  { key: 'inventory_bill', name: '库存 / 出入库', keywords: ['inventory', 'warehouse', 'wms', 'inbound', 'outbound', 'storehouse'] },
  { key: 'basic_master', name: '基础资料 / 主数据', keywords: ['basic', 'category', 'product', 'customer', 'supplier', 'company', 'department', 'staff'] },
  { key: 'bill_common', name: '单据公共能力', keywords: ['common', 'code', 'verify', 'rule', 'import', 'template'] },
];

const TERM_TRANSLATIONS = {
  ai: 'AI',
  chat: '对话',
  session: '会话',
  stream: '流式',
  preview: '预览',
  submit: '提交',
  bill: '单据',
  finance: '财务',
  settlement: '结算',
  basic: '基础',
  category: '分类',
  info: '信息',
  product: '商品',
  gift: '赠品',
  type: '类型',
  inventory: '库存',
  warehouse: '仓库',
  inbound: '入库',
  outbound: '出库',
  import: '导入',
  record: '记录',
  company: '企业',
  department: '部门',
  staff: '员工',
  user: '用户',
  knowledge: '知识',
  vector: '向量',
  common: '公共',
  code: '编码',
  verify: '校验',
  sync: '同步',
  feedback: '反馈',
  order: '订单',
  income: '收入',
  log: '日志',
  logs: '日志',
  detail: '明细',
  details: '明细',
  template: '模板',
  list: '列表',
  paged: '分页',
  page: '分页',
  all: '全部',
  top: 'TOP',
  enable: '启用',
  disable: '停用',
  remove: '删除',
  delete: '删除',
  update: '更新',
  edit: '更新',
  add: '创建',
  create: '创建',
  get: '查询',
  query: '查询',
};

const OPERATION_TRANSLATIONS = [
  { pattern: /(chat\/stream|\/stream$)/i, label: '流式处理' },
  { pattern: /(submitbill|\/submit)/i, label: '提交' },
  { pattern: /(syncbillpreview|preview)/i, label: '预览' },
  { pattern: /feedback/i, label: '反馈纠偏' },
  { pattern: /session/i, label: '会话建立' },
  { pattern: /(listpaged|listtop|listall|listby|\/list|\/page|query|get)/i, label: '查询' },
  { pattern: /(add|create)/i, label: '创建' },
  { pattern: /(update|edit)/i, label: '更新' },
  { pattern: /(remove|delete)/i, label: '删除' },
  { pattern: /enable/i, label: '启用' },
  { pattern: /disable/i, label: '停用' },
  { pattern: /verify/i, label: '校验' },
];

function compactDomainName(name) {
  return normalizeText(name).replace(/\s*\/\s*/g, '').replace(/\s+/g, '');
}

function translateTokens(tokens = []) {
  return toArray(tokens)
    .map((token) => TERM_TRANSLATIONS[token] || (/^\d+$/.test(token) ? token : titleFromToken(token)))
    .filter(Boolean);
}

function humanizePathFragment(value) {
  const tokens = splitSemanticTokens(value).filter((token) => !['api', 'v1', 'v0', 'rest'].includes(token));
  return translateTokens(tokens).join('');
}

function resolveDomainDisplayName(domainKey) {
  const entry = DOMAIN_KEYWORD_CATALOG.find((item) => item.key === normalizeText(domainKey));
  return entry ? compactDomainName(entry.name) : '';
}

function inferOperationLabel(pathText, method) {
  const normalized = normalizeText(pathText).toLowerCase();
  const matched = OPERATION_TRANSLATIONS.find((item) => item.pattern.test(normalized));
  if (matched) return matched.label;
  const normalizedMethod = normalizeText(method).toUpperCase();
  if (normalizedMethod === 'GET') return '查询';
  if (normalizedMethod === 'DELETE') return '删除';
  if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') return '更新';
  if (normalizedMethod === 'POST') return '提交';
  return '处理';
}

function inferResourceLabel(pathText, domainKey) {
  const domainDisplay = resolveDomainDisplayName(domainKey);
  const segments = normalizeText(pathText)
    .split('?')[0]
    .split('/')
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .filter((item) => !/^api$/i.test(item) && !/^v\d+(\.\d+)?$/i.test(item) && !/^\{.+\}$/.test(item));
  const opLabel = inferOperationLabel(pathText, '');
  const operationLike = new Set(['list', 'listpaged', 'listall', 'listtop100', 'listtop', 'page', 'query', 'get', 'add', 'create', 'update', 'edit', 'remove', 'delete', 'enable', 'disable', 'preview', 'feedback', 'session', 'stream', 'verify', 'submit', 'submitbill', 'syncbillpreview']);
  const resourceSegments = segments.filter((item, index) => index < segments.length - 1 || !operationLike.has(item.toLowerCase()));
  const resourceLabel = humanizePathFragment(resourceSegments.join(' '));
  if (domainDisplay && resourceLabel && resourceLabel.includes(domainDisplay)) return resourceLabel;
  if (domainDisplay) return domainDisplay;
  if (resourceLabel) return resourceLabel;
  return humanizePathFragment(segments.slice(-2).join(' ')) || opLabel;
}

function refineCapabilityLabel(value, domainKey = '') {
  let text = normalizeText(value);
  if (!text) return '';
  if (/^查询(.+)(列表|清单)$/.test(text)) {
    text = text.replace(/^查询(.+)(列表|清单)$/, '$1查询');
  }
  if (/^创建收入订单$/.test(text)) return '收入单创建';
  if (/^查询收入列表$/.test(text)) return '收入单查询';
  if (/^创建付款订单$/.test(text)) return '付款单创建';
  if (/^创建收款订单$/.test(text)) return '收款单创建';
  if (/^财务单据处理$/.test(text)) return '';
  if (/^库存出入库处理$/.test(text)) return '';
  if (/^基础资料主数据处理$/.test(text)) return '';
  if (/^单据公共能力提交$/.test(text)) return '';
  const domainDisplay = resolveDomainDisplayName(domainKey);
  if (
    domainDisplay &&
    text === `${domainDisplay}处理`
  ) {
    return '';
  }
  return text;
}

function normalizeCapabilityLabel(value, domainKey = '') {
  const text = normalizeText(value);
  if (!text || isWeakCapabilityLabel(text)) return '';
  if (/[\u4e00-\u9fa5]/.test(text)) return text;
  const humanized = humanizePathFragment(text);
  if (!humanized || isWeakCapabilityLabel(humanized)) return '';
  const domainDisplay = resolveDomainDisplayName(domainKey);
  if (/^(查询|创建|更新|删除|提交|预览|反馈纠偏|会话建立|流式处理|校验|启用|停用|处理|同步)$/.test(humanized) && domainDisplay) {
    return `${domainDisplay}${humanized}`;
  }
  if (domainDisplay && !humanized.includes(domainDisplay) && /(查询|创建|更新|删除|提交|预览|反馈|会话|校验|启用|停用|处理|同步)$/.test(humanized)) {
    return `${domainDisplay}${humanized}`;
  }
  return humanized;
}

function normalizePathToken(value) {
  return normalizeText(value)
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function normalizeRoutePattern(value) {
  const text = normalizeText(value)
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/{2,}/g, '/');
  if (!text) return '';
  if (text.length > 1 && text.endsWith('/')) return text.slice(0, -1);
  return text;
}

function tokenizeForDomain(value) {
  return splitSemanticTokens(normalizePathToken(value));
}

function filterNoiseItems(items) {
  return toArray(items).filter((item) => {
    const text = normalizeText(typeof item === 'string' ? item : item.path || item.source || item.symbol || item.title);
    return text && !/(^|[/_.-])(test|tests|spec|specs|mock|fixture)([/_.-]|$)/i.test(text);
  });
}

function dedupeByPath(items, selector) {
  return uniqueBy(filterNoiseItems(items), (item) => normalizeText(selector(item)).toLowerCase());
}

const MATCHING_NOISE_TOKENS = new Set([
  'frontend',
  'service',
  'src',
  'views',
  'view',
  'components',
  'component',
  'mixins',
  'utils',
  'main',
  'java',
  'resources',
  'application',
  'controller',
  'controllers',
  'rest',
  'api',
  'apis',
  'index',
  'vue',
  'jsx',
  'tsx',
  'js',
  'ts',
  'pc',
  'com',
  'codeup',
  'aliyun',
  'aiplan',
  'erp',
  'application',
  'service',
]);

function isHashLikeToken(value) {
  return /^[0-9a-f]{8,}$/i.test(normalizeText(value));
}

function semanticPathForMatching(value, kind = 'generic') {
  const normalized = normalizePathToken(value);
  if (!normalized) return '';
  const srcIndex = normalized.toLowerCase().indexOf('src/');
  const trimmed = srcIndex >= 0 ? normalized.slice(srcIndex + 4) : normalized;
  if (kind === 'page') {
    return trimmed.replace(/^views\//i, '').replace(/^pages\//i, '');
  }
  if (kind === 'api') {
    return trimmed.replace(/^api\//i, '').replace(/^views\//i, '');
  }
  return trimmed;
}

function semanticTokensForMatching(value, kind = 'generic') {
  const tokens = splitSemanticTokens(semanticPathForMatching(value, kind));
  return tokens.filter((token) => {
    if (!token) return false;
    if (MATCHING_NOISE_TOKENS.has(token)) return false;
    if (/^v\d+$/.test(token)) return false;
    if (isHashLikeToken(token)) return false;
    return true;
  });
}

function semanticDomainKeyFromValue(value, kind = 'generic') {
  return (detectDomainByValue(semanticPathForMatching(value, kind)) || {}).key || '';
}

function isWeakFrontendEntry(value) {
  const normalized = semanticPathForMatching(value, 'page').toLowerCase();
  if (!normalized) return true;
  return /(dashboard|chart|linechart|barchart|piechart|raddarchart|panelgroup|resize|401|404|error|validate|mixin)/i.test(normalized);
}

function exactTokenOverlap(left = [], right = []) {
  const leftSet = new Set(toArray(left).map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
  const rightSet = new Set(toArray(right).map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
  let score = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) score += 1;
  });
  return score;
}

function repoTail(repoId) {
  const parts = normalizeText(repoId).split('/').filter(Boolean);
  return parts.slice(-1)[0] || normalizeText(repoId);
}

function repoLabel(repo = {}) {
  const role = normalizeText(repo.role);
  const tail = repoTail(repo.repoId);
  if (role === 'frontend') return `前端 · ${tail}`;
  if (role === 'bff') return `BFF · ${tail}`;
  if (role === 'backend' || role === 'service') return `后端 · ${tail}`;
  return `${role || '仓库'} · ${tail}`;
}

function pageLabelFromPath(pagePath) {
  const normalized = normalizePathToken(pagePath);
  const base = normalized.split('/').pop() || normalized;
  const clean = base
    .replace(/\.(vue|tsx?|jsx?)$/i, '')
    .replace(/^(add-or-edit|add-or-update)$/i, 'edit-form')
    .replace(/^(index|detail|list|edit|add)$/i, (match) => match);
  return titleFromToken(clean);
}

function pageActionLabel(pagePath) {
  const normalized = normalizePathToken(pagePath).toLowerCase();
  if (normalized.includes('aiorderingassistant') || normalized.includes('/ai/') || normalized.includes('chat') || normalized.includes('stream')) return 'AI 协同助手';
  if (normalized.includes('/finance/') || normalized.includes('/fee/') || normalized.includes('bank.vue') || normalized.includes('change-status') || normalized.includes('add-or-edit')) return '财务单据处理';
  if (normalized.includes('/order') || normalized.includes('submitorder') || normalized.includes('cancelorder')) return '订单处理';
  if (normalized.includes('/finance/') || normalized.includes('fee') || normalized.includes('income')) return '财务单据处理';
  if (normalized.includes('/goods/') || normalized.includes('product')) return '商品资料管理';
  if (normalized.includes('/warehouse/') || normalized.includes('storehouse') || normalized.includes('inventory')) return '库存出入库处理';
  if (normalized.includes('/company/') || normalized.includes('staff') || normalized.includes('department')) return '企业组织资料维护';
  return `${pageLabelFromPath(pagePath) || '业务页面'}操作`;
}

function domainCatalogEntryForTokens(tokens = []) {
  let best = null;
  let bestScore = 0;
  const tokenMatchesKeyword = (token, keyword) => {
    const normalizedToken = normalizeText(token).toLowerCase();
    const normalizedKeyword = normalizeText(keyword).toLowerCase();
    if (!normalizedToken || !normalizedKeyword) return false;
    if (normalizedToken === normalizedKeyword) return true;
    if (normalizedToken.length <= 2 || normalizedKeyword.length <= 2) {
      return false;
    }
    return normalizedToken.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedToken);
  };
  DOMAIN_KEYWORD_CATALOG.forEach((entry) => {
    const score = entry.keywords.reduce((sum, keyword) => sum + (tokens.some((token) => tokenMatchesKeyword(token, keyword)) ? 1 : 0), 0);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  });
  return bestScore > 0 ? best : null;
}

function detectDomainByValue(value) {
  const tokens = tokenizeForDomain(value);
  const hasKeyword = (keywords = []) => keywords.some((keyword) => tokens.includes(normalizeText(keyword).toLowerCase()));
  if (hasKeyword(['ai', 'chat', 'session', 'stream', 'feedback', 'knowledge', 'prompt', 'submitbill', 'syncbillpreview'])) {
    return DOMAIN_KEYWORD_CATALOG.find((item) => item.key === 'ai_ordering') || null;
  }
  if (hasKeyword(['inventory', 'warehouse', 'wms', 'inbound', 'outbound', 'storehouse'])) {
    return DOMAIN_KEYWORD_CATALOG.find((item) => item.key === 'inventory_bill') || null;
  }
  if (hasKeyword(['finance', 'fee', 'income', 'settlement', 'bank', 'payable', 'receivable'])) {
    return DOMAIN_KEYWORD_CATALOG.find((item) => item.key === 'finance_bill') || null;
  }
  if (hasKeyword(['basic', 'category', 'product', 'customer', 'supplier', 'company', 'department', 'staff'])) {
    return DOMAIN_KEYWORD_CATALOG.find((item) => item.key === 'basic_master') || null;
  }
  if (hasKeyword(['common', 'code', 'verify', 'rule', 'import', 'template'])) {
    return DOMAIN_KEYWORD_CATALOG.find((item) => item.key === 'bill_common') || null;
  }
  return domainCatalogEntryForTokens(tokens);
}

function businessActionFromEndpoint(contract = {}) {
  const pathText = normalizeText(contract.path || contract.route || contract.endpoint || '');
  const actionText = normalizeText(contract.businessAction || contract.action || contract.controllerClass);
  const normalized = pathText.toLowerCase();
  if (normalized.includes('/billcommon/generatebillcode')) return '生成单据编码';
  if (normalized.includes('/billcommon/listwmsinventory')) return '查询库存台账';
  if (normalized.includes('/billcommon/verifyinventorybillbycode')) return '校验库存单据编码';
  if (normalized.includes('/ai/chat') && !normalized.includes('/chat/stream') && !normalized.includes('/chat/submitbill')) {
    return '智能会话提问';
  }
  if (normalized.includes('/chat/stream')) return '智能协同流式回复';
  if (normalized.includes('/chat/submitbill')) return '智能提单提交';
  if (normalized.includes('/syncbillpreview')) return '智能单据预览';
  if (normalized.includes('/feedback')) return '结果反馈纠偏';
  if (normalized.includes('/session')) return '智能会话建立';
  if (normalized.includes('/fundfeebill/insertdraft')) return '创建费用单草稿';
  if (normalized.includes('/fundfeebill/modifydraft')) return '更新费用单草稿';
  if (normalized.includes('/fundfeebill/confirm')) return '提交费用单确认';
  if (normalized.includes('/fundfeebill/listpaged')) return '费用单查询';
  if (normalized.includes('/fundincomebill/insertdraft')) return '创建收入单草稿';
  if (normalized.includes('/fundincomebill/modifydraft')) return '更新收入单草稿';
  if (normalized.includes('/fundincomebill/confirm')) return '提交收入单确认';
  if (normalized.includes('/fundincomebill/remove')) return '删除收入单';
  if (normalized.includes('/fundincomebill/cancel')) return '作废收入单';
  if (normalized.includes('/fundincomebill/copy')) return '复制收入单';
  if (normalized.includes('/fundincomebill/listpaged')) return '收入单查询';
  if (normalized.includes('/financepaybill/insertdraft')) return '创建付款单草稿';
  if (normalized.includes('/financepaybill/modifydraft')) return '更新付款单草稿';
  if (normalized.includes('/financepaybill/modifyconfirm')) return '提交付款单确认';
  if (normalized.includes('/financereceivebill/listsettlementbillpaged')) return '结算单查询';
  if (normalized.includes('/financereceivebill/listpaged')) return '收款单查询';
  if (normalized.includes('/financereceivebill/insertconfirm')) return '提交收款单确认';
  if (normalized.includes('/financereceivebill/insertdraft')) return '创建收款单草稿';
  if (normalized.includes('/financereceivebill/modifydraft')) return '更新收款单草稿';
  if (actionText) {
    if (isTechnicalLabel(actionText)) {
      // fall through to path-based business naming
    } else {
      return actionText
        .replace(/\b(listPaged|listAll|listTop100|listBy\w+|page|paged)\b/gi, '查询')
        .replace(/\b(add|create)\b/gi, '创建')
        .replace(/\b(update|edit)\b/gi, '更新')
        .replace(/\b(remove|delete)\b/gi, '删除')
        .replace(/\b(enable)\b/gi, '启用')
        .replace(/\b(disable)\b/gi, '停用');
    }
  }
  const operationLabel = inferOperationLabel(pathText, contract.method);
  const resourceLabel = inferResourceLabel(pathText, contract.domainKey);
  if (resourceLabel && operationLabel) {
    return `${resourceLabel}${operationLabel}`;
  }
  if (resourceLabel) return resourceLabel;
  return titleFromToken(pathText.split('/').filter(Boolean).slice(-2).join(' ')) || pathText || '业务动作';
}

function apiStepBusinessLabel(actionLabel, pathText = '') {
  const text = normalizeText(actionLabel);
  if (!text) return normalizeText(pathText) ? `请求${normalizeText(pathText)}` : '发起业务请求';
  if (/^(查询|校验)/.test(text)) return `发起${text}`;
  if (/^(创建|更新|提交|删除|作废|复制|启用|停用|同步|结果反馈纠偏|智能会话建立|智能协同流式回复|智能提单提交|智能单据预览)/.test(text)) {
    return `发起${text}`;
  }
  return `请求${text}`;
}

function nounLabelFromTable(tableName) {
  const normalized = normalizeText(tableName).replace(/^tbl_/, '').replace(/^sys_/, '系统 ').replace(/^ai_/, 'AI ');
  if (/^orders?$/i.test(normalized)) return '订单';
  if (/conversation/i.test(normalized)) return '会话记录';
  if (/feedback/i.test(normalized)) return '反馈记录';
  if (/knowledge/i.test(normalized)) return '知识条目';
  if (/prompt/i.test(normalized)) return '提示词片段';
  return humanizePathFragment(normalized.replace(/_/g, ' ')) || titleFromToken(normalized.replace(/_/g, ' '));
}

function buildPageActionMatches(frontendPages = [], apiContracts = []) {
  return dedupeByPath(frontendPages, (page) => page.path || page.source || page.pageId || page)
    .map((page, index) => {
      const value = typeof page === 'string' ? { path: page } : ensureObject(page);
      const pagePath = normalizeText(value.path || value.source || value.pageId);
      if (!pagePath || isWeakFrontendEntry(pagePath)) return null;
      const pageTokens = semanticTokensForMatching(pagePath, 'page');
      const pageDomainKey = semanticDomainKeyFromValue(pagePath, 'page');
      const label = pageActionLabel(semanticPathForMatching(pagePath, 'page'));
      const matchedContracts = toArray(apiContracts)
        .map((contract) => {
          const contractDomainKey =
            semanticDomainKeyFromValue([contract.path, contract.action, contract.source].join(' '), 'api') ||
            normalizeText(contract.domainKey);
          const apiTokens = uniqueStrings([
            ...semanticTokensForMatching(contract.path, 'api'),
            ...semanticTokensForMatching(contract.source, 'api'),
            ...semanticTokensForMatching(contract.action, 'api'),
          ]);
          const overlap = exactTokenOverlap(pageTokens, apiTokens);
          const sameDomain = pageDomainKey && contractDomainKey && pageDomainKey === contractDomainKey;
          const conflictingDomain = pageDomainKey && contractDomainKey && pageDomainKey !== contractDomainKey;
          const score = overlap * 3 + (sameDomain ? 6 : 0) - (conflictingDomain ? 8 : 0);
          return {
            contract: {
              ...contract,
              domainKey: contractDomainKey || contract.domainKey || '',
            },
            overlap,
            score,
          };
        })
        .filter((item) => item.score >= 4)
        .sort((left, right) => right.score - left.score || right.overlap - left.overlap)
        .slice(0, 2)
        .map((item) => item.contract);
      return {
        pageId: normalizeText(value.pageId || pagePath || `page_${index + 1}`),
        path: pagePath,
        label,
        tokens: pageTokens,
        domainKey: pageDomainKey,
        matchedContracts,
      };
    })
    .filter((item) => item && item.path);
}

function collectDomainEvidenceSets(domainKey, sources = {}) {
  return {
    apis: toArray(sources.apiContracts).filter((item) => normalizeText(item.domainKey) === normalizeText(domainKey)),
    tables: toArray(sources.erModel).filter((item) => normalizeText(item.domainKey) === normalizeText(domainKey)),
    events: toArray(sources.eventCatalog).filter((item) => normalizeText(item.domainKey) === normalizeText(domainKey)),
    pages: toArray(sources.frontendJourneys).filter((item) => normalizeText(item.domainKey) === normalizeText(domainKey)),
    symbols: toArray(sources.symbols).filter((item) => normalizeText(item.domainKey) === normalizeText(domainKey)),
  };
}

function canonicalRepoRole(value) {
  const normalized = normalizeRepoRole(value);
  if (normalized === 'shared_lib') return 'shared';
  if (normalized === 'test_automation') return 'test';
  if (normalized === 'unknown') {
    const raw = normalizeText(value).toLowerCase();
    if (raw === 'shared') return 'shared';
    if (raw === 'test') return 'test';
  }
  return normalized;
}

function inferSubsystem(role) {
  switch (canonicalRepoRole(role)) {
    case 'frontend':
      return 'experience';
    case 'bff':
      return 'gateway';
    case 'backend':
      return 'core';
    case 'shared':
      return 'shared';
    case 'test':
      return 'quality';
    case 'infra':
      return 'platform';
    default:
      return 'unknown';
  }
}

function repoIdOf(repo, index) {
  return (
    normalizeText(repo && (repo.repoId || repo.repo_id || repo.repoSlug || repo.repo_slug || repo.name)) ||
    `repo-${index + 1}`
  );
}

function normalizeRepo(repo, index, config) {
  const repoId = repoIdOf(repo, index);
  const role = canonicalRepoRole(repo && repo.role);
  return {
    repoId,
    role,
    root: normalizeText(repo && repo.root) || `./repos/${repoId}`,
    branch: normalizeText(repo && repo.branch) || normalizeText(config && config.versionLine) || 'main',
    commitSha: normalizeText(repo && (repo.commitSha || repo.commit_sha)) || '',
    subsystem: normalizeText(repo && repo.subsystem) || inferSubsystem(role),
    manifests: uniqueStrings(repo && repo.manifests),
    dependencies: uniqueStrings(repo && repo.dependencies),
    apiCalls: toArray(repo && repo.apiCalls),
    apiFiles: toArray(repo && repo.apiFiles),
    apis: toArray(repo && (repo.apis || repo.apiEndpoints)),
    frontendPages: toArray(repo && repo.frontendPages),
    tables: toArray(repo && repo.tables),
    events: toArray(repo && repo.events),
    handlers: toArray(repo && repo.handlers),
    controllers: toArray(repo && repo.controllers),
    services: toArray(repo && repo.services),
    repositories: toArray(repo && repo.repositories),
    entities: toArray(repo && repo.entities),
    dtos: toArray(repo && repo.dtos),
    utils: toArray(repo && repo.utils),
    tests: toArray(repo && repo.tests),
  };
}

function normalizeRepos(config) {
  return toArray(config && config.repos).map((repo, index) => normalizeRepo(repo, index, config));
}

function normalizeSymbolEntries(values, repoId, fallbackKind) {
  return toArray(values).map((item) => {
    if (typeof item === 'string') {
      return {
        repoId,
        symbol: item,
        kind: fallbackKind,
        path: '',
        layer: fallbackKind,
      };
    }
    const value = ensureObject(item);
    return {
      repoId,
      symbol: normalizeText(value.symbol || value.name || value.path || `${repoId}_${fallbackKind}`),
      kind: normalizeText(value.kind || fallbackKind) || fallbackKind,
      path: normalizeText(value.path),
      layer: normalizeText(value.layer || fallbackKind) || fallbackKind,
      pageId: normalizeText(value.pageId || value.page_id),
      action: normalizeText(value.action),
    };
  });
}

function deriveRepoUnderstanding(config) {
  const repos = normalizeRepos(config);
  const projectTopology = {
    projectId: config && config.projectId ? config.projectId : null,
    projectCode: normalizeText(config && config.projectCode),
    projectName: normalizeText(config && config.projectName),
    versionLine: normalizeText(config && config.versionLine) || 'main',
    repos,
  };
  const repoManifestSet = {
    repos: repos.map((repo) => ({
      repoId: repo.repoId,
      role: repo.role,
      root: repo.root,
      branch: repo.branch,
      commitSha: repo.commitSha,
      manifests: repo.manifests,
      dependencies: repo.dependencies,
    })),
  };
  const repoRoleMatrix = repos.map((repo) => ({
    repoId: repo.repoId,
    role: repo.role,
    subsystem: repo.subsystem,
  }));
  const subsystemClusters = Object.values(
    repos.reduce((acc, repo) => {
      if (!acc[repo.subsystem]) {
        acc[repo.subsystem] = {
          subsystem: repo.subsystem,
          repos: [],
          roles: [],
        };
      }
      acc[repo.subsystem].repos.push(repo.repoId);
      acc[repo.subsystem].roles.push(repo.role);
      return acc;
    }, {})
  ).map((cluster) => ({
    subsystem: cluster.subsystem,
    repos: uniqueStrings(cluster.repos),
    roles: uniqueStrings(cluster.roles),
  }));
  return {
    projectTopology,
    repoManifestSet,
    repoRoleMatrix,
    subsystemClusters,
  };
}

function deriveStructureAssets(config, topology) {
  const repos = toArray(topology && topology.repos).length ? topology.repos : normalizeRepos(config);
  const allApiContracts = repos.flatMap((repo) => toArray(repo.apis).map((entry) => normalizeApiContract(entry, repo.repoId)));
  const pageActionMatches = repos.flatMap((repo) =>
    buildPageActionMatches(repo.frontendPages, allApiContracts).map((item) => ({
      ...item,
      repoId: repo.repoId,
    }))
  );
  const symbols = uniqueBy(
    repos.flatMap((repo) => [
      ...normalizeSymbolEntries(filterNoiseItems(repo.frontendPages).map((page) => ({
        symbol: normalizeText((typeof page === 'string' ? '' : page.pageId) || (typeof page === 'string' ? page : page.title || page.path) || `${repo.repoId}_page`),
        kind: 'page',
        path: normalizeText(typeof page === 'string' ? page : page.path || page.source),
        layer: 'frontend',
        pageId: normalizeText(typeof page === 'string' ? page : page.pageId),
        action: normalizeText(typeof page === 'string' ? pageActionLabel(page) : page.action || page.title || pageActionLabel(page.path || page.source)),
      })), repo.repoId, 'page'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.handlers), repo.repoId, 'route_handler'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.controllers), repo.repoId, 'controller'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.services), repo.repoId, 'service'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.repositories), repo.repoId, 'repository'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.entities), repo.repoId, 'entity'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.dtos), repo.repoId, 'dto'),
      ...normalizeSymbolEntries(filterNoiseItems(repo.utils), repo.repoId, 'util'),
      ...normalizeSymbolEntries(repo.tests, repo.repoId, 'test'),
    ]),
    (item) => `${item.repoId}:${item.symbol}:${item.kind}`
  ).map((item) => {
      const domainEntry = detectDomainByValue([item.path, item.symbol, item.action].join(' '));
      return {
        ...item,
        domainKey: domainEntry ? domainEntry.key : '',
        businessLabel:
        item.kind === 'page'
          ? pageActionLabel(semanticPathForMatching(item.path || item.symbol, 'page'))
          : item.kind === 'controller' || item.kind === 'service'
            ? titleFromToken(String(item.symbol).replace(/Controller|Service|Impl|RpcImpl$/g, ''))
            : titleFromToken(item.symbol),
    };
  });

  const callGraph = [];
  repos.forEach((repo) => {
    toArray(repo.apiCalls).forEach((call, index) => {
      const value = ensureObject(call);
      const from = normalizeText(value.from || value.action || value.pageId || `${repo.repoId}:call:${index + 1}`);
      const toRepo = normalizeText(value.targetRepoId || value.target_repo_id || value.providerRepoId || repo.repoId);
      const path = normalizeText(value.path || value.endpoint || value.request);
      callGraph.push({
        id: `${repo.repoId}:http:${index + 1}`,
        from,
        to: `${toRepo}:${path || 'request'}`,
        fromRepo: repo.repoId,
        toRepo,
        edgeType: 'http',
        method: normalizeText(value.method || 'GET') || 'GET',
        path,
      });
    });
    toArray(repo.dependencies).forEach((targetRepoId, index) => {
      callGraph.push({
        id: `${repo.repoId}:depends:${index + 1}`,
        from: repo.repoId,
        to: targetRepoId,
        fromRepo: repo.repoId,
        toRepo: normalizeText(targetRepoId),
        edgeType: 'dependency',
      });
    });
    toArray(repo.events).forEach((event, index) => {
      const value = ensureObject(event);
      const consumers = uniqueStrings([value.consumerRepoId, ...(value.consumerRepoIds || [])]);
      consumers.forEach((consumerRepoId, consumerIndex) => {
        callGraph.push({
          id: `${repo.repoId}:event:${index + 1}:${consumerIndex + 1}`,
          from: normalizeText(value.name || value.event || `event_${index + 1}`),
          to: `${consumerRepoId}:${normalizeText(value.topic || value.name || value.event)}`,
          fromRepo: repo.repoId,
          toRepo: consumerRepoId,
          edgeType: 'event',
          topic: normalizeText(value.topic || value.name || value.event),
        });
      });
    });
  });

  pageActionMatches.forEach((pageMatch, index) => {
    pageMatch.matchedContracts.forEach((contract, contractIndex) => {
      callGraph.push({
        id: `${pageMatch.repoId}:journey:${index + 1}:${contractIndex + 1}`,
        from: pageMatch.pageId,
        to: `${contract.repoId}:${contract.method} ${contract.path}`,
        fromRepo: pageMatch.repoId,
        toRepo: contract.repoId,
        edgeType: 'route',
        method: contract.method,
        path: contract.path,
        businessAction: pageMatch.label,
      });
    });
  });

  const crossRepoEdges = uniqueBy(
    callGraph
      .filter((edge) => normalizeText(edge.fromRepo) && normalizeText(edge.toRepo) && edge.fromRepo !== edge.toRepo)
      .map((edge) => ({
        fromRepo: edge.fromRepo,
        toRepo: edge.toRepo,
        edgeType: edge.edgeType,
        path: edge.path || edge.topic || '',
      })),
    (item) => `${item.fromRepo}:${item.toRepo}:${item.edgeType}:${item.path}`
  );

  const layerClassification = {
    frontend: symbols.filter((item) => item.kind === 'page' || item.kind === 'route_handler').map((item) => item.symbol),
    application: symbols.filter((item) => item.kind === 'controller' || item.kind === 'service').map((item) => item.symbol),
    domain: symbols.filter((item) => item.kind === 'entity').map((item) => item.symbol),
    data: symbols.filter((item) => item.kind === 'repository' || item.kind === 'dto').map((item) => item.symbol),
    support: symbols.filter((item) => item.kind === 'util' || item.kind === 'test').map((item) => item.symbol),
  };

  const routeGraph = pageActionMatches.flatMap((pageMatch) =>
    toArray(pageMatch.matchedContracts).map((contract) => ({
      pageId: pageMatch.pageId,
      pageLabel: pageMatch.label,
      pagePath: pageMatch.path,
      consumerRepoId: pageMatch.repoId,
      providerRepoId: contract.repoId,
      method: contract.method,
      path: contract.path,
      operationId: contract.operationId,
      action: contract.action,
      domainKey: normalizeText(contract.domainKey) || pageMatch.domainKey || '',
    }))
  );

  return {
    symbols,
    callGraph,
    routeGraph,
    crossRepoEdges,
    layerClassification,
    layeredArchitecture: {
      layers: Object.keys(layerClassification).filter((key) => layerClassification[key].length),
      repoCount: repos.length,
      symbolCount: symbols.length,
      edgeCount: callGraph.length,
    },
  };
}

function normalizeApiContract(entry, repoId, fallbackMethod = 'GET') {
  if (typeof entry === 'string') {
    const parts = entry.trim().split(/\s+/);
    return {
      repoId,
      method: normalizeText(parts[0] || fallbackMethod).toUpperCase(),
      path: normalizeText(parts.slice(1).join(' ') || entry),
      operationId: kebabCase(entry),
      action: titleFromToken(parts.slice(1).pop() || entry),
      source: 'config_string',
    };
  }
  const value = ensureObject(entry);
  const method = normalizeText(value.method || fallbackMethod).toUpperCase() || fallbackMethod;
  const routePath = normalizeRoutePattern(value.path || value.route || value.endpoint || '/');
  return {
    repoId,
    method,
    path: routePath,
    operationId: kebabCase(value.operationId || `${method}-${routePath}`),
    action: normalizeText(value.action || value.title || titleFromToken(routePath)),
    source: normalizeText(value.source || value.path || routePath),
  };
}

function findMatchingApiContract(apiContracts, request) {
  const requestMethod = normalizeText(request && request.method).toUpperCase();
  const requestPath = normalizeRoutePattern(request && request.path);
  return toArray(apiContracts).find((contract) => {
    return (
      normalizeText(contract.method).toUpperCase() === requestMethod &&
      normalizeRoutePattern(contract.path) === requestPath
    );
  }) || null;
}

function normalizeTable(entry, repoId) {
  if (typeof entry === 'string') {
    return {
      repoId,
      table: entry,
      pk: 'id',
      states: [],
      path: '',
      columns: [],
      tableComment: '',
    };
  }
  const value = ensureObject(entry);
  return {
    repoId,
    table: normalizeText(value.table || value.table_name || value.name),
    pk: normalizeText(value.pk || value.primaryKey || 'id'),
    states: uniqueStrings(value.states),
    path: normalizeText(value.path),
    columns: toArray(value.columns),
    tableComment: normalizeText(value.tableComment || value.comment),
  };
}

function normalizeEvent(entry, repoId) {
  if (typeof entry === 'string') {
    return {
      repoId,
      event: entry,
      topic: entry,
      consumers: [],
    };
  }
  const value = ensureObject(entry);
  return {
    repoId,
    event: normalizeText(value.event || value.name),
    topic: normalizeText(value.topic || value.event || value.name),
    consumers: uniqueStrings([value.consumerRepoId, ...(value.consumerRepoIds || [])]),
  };
}

function deriveDataContractAssets(config, topology, structure) {
  const repos = toArray(topology && topology.repos).length ? topology.repos : normalizeRepos(config);
  const apiContracts = uniqueBy(
    repos.flatMap((repo) => toArray(repo.apis).map((entry) => normalizeApiContract(entry, repo.repoId))),
    (item) => `${item.repoId}:${item.method}:${item.path}`
  ).map((item) => {
    const domainEntry = detectDomainByValue([item.path, item.action, item.source].join(' '));
    const domainKey = domainEntry ? domainEntry.key : '';
    return {
      ...item,
      domainKey,
      businessAction: businessActionFromEndpoint({ ...item, domainKey }),
    };
  });
  const explicitFrontendRequests = repos
    .filter((repo) => repo.role === 'frontend')
    .flatMap((repo) =>
      toArray(repo.apiCalls).map((call, index) => {
        const value = ensureObject(call);
        const request = normalizeApiContract(
          {
            method: value.method || 'GET',
            path: value.path || value.endpoint || value.request || '/',
            action: value.action || value.pageAction || value.pageId || `request_${index + 1}`,
            source: value.source || value.path || value.endpoint,
          },
          normalizeText(value.targetRepoId || value.providerRepoId || ''),
          value.method || 'GET'
        );
        const matchedContract = findMatchingApiContract(apiContracts, request);
        const domainEntry = detectDomainByValue([request.path, request.action, value.pageAction, value.sourceLabel].join(' '));
        return {
          pageAction: normalizeText(value.pageAction || value.action || value.pageId || request.action),
          pageId: normalizeText(value.pageId || value.source || request.action),
          request: `${request.method} ${normalizeRoutePattern(request.path)}`,
          consumerRepoId: repo.repoId,
          providerRepoId: normalizeText(value.targetRepoId || value.providerRepoId || matchedContract?.repoId),
          matched: Boolean(matchedContract),
          domainKey: normalizeText(value.domainKey || matchedContract?.domainKey || (domainEntry ? domainEntry.key : '')),
          sourceLabel: normalizeText(value.sourceLabel || value.source || value.pageId),
          bindingType: 'explicit_frontend_api',
        };
      })
    );
  const explicitRequestKeys = new Set(
    explicitFrontendRequests.map((item) => `${normalizeText(item.domainKey)}::${normalizeText(item.request).toUpperCase()}`)
  );
  const frontendRequestMap = uniqueBy(
    [
      ...toArray(structure.routeGraph)
        .map((item) => {
        const matchedContract = findMatchingApiContract(apiContracts, item);
        return {
          pageAction: item.pageLabel,
          pageId: item.pageId,
          request: `${item.method} ${normalizeRoutePattern(item.path)}`,
          consumerRepoId: item.consumerRepoId,
          providerRepoId: normalizeText(item.providerRepoId || matchedContract?.repoId),
          matched: Boolean(matchedContract || item.providerRepoId),
          domainKey: normalizeText(item.domainKey || matchedContract?.domainKey),
          sourceLabel: normalizeText(item.pagePath || item.pageId),
          bindingType: 'heuristic_page_match',
        };
      })
        .filter((item) => !explicitRequestKeys.has(`${normalizeText(item.domainKey)}::${normalizeText(item.request).toUpperCase()}`)),
      ...explicitFrontendRequests,
    ],
    (item) => `${item.consumerRepoId}:${item.pageAction}:${item.request}`
  );
  const erModel = uniqueBy(
    repos.flatMap((repo) => toArray(repo.tables).map((table) => normalizeTable(table, repo.repoId))).filter((item) => item.table),
    (item) => `${item.repoId}:${item.table}`
  ).map((item) => {
    const domainEntry = detectDomainByValue([item.table, item.path].join(' '));
    return {
      ...item,
      domainKey: domainEntry ? domainEntry.key : '',
      businessLabel: nounLabelFromTable(item.table),
    };
  });
  const eventCatalog = uniqueBy(
    repos.flatMap((repo) => toArray(repo.events).map((event) => normalizeEvent(event, repo.repoId))).filter((item) => item.event),
    (item) => `${item.repoId}:${item.event}:${item.topic}`
  ).map((item) => {
    const domainEntry = detectDomainByValue([item.event, item.topic].join(' '));
    return {
      ...item,
      domainKey: domainEntry ? domainEntry.key : '',
      businessLabel: titleFromToken(item.event),
    };
  });
  const unmatchedRequests = frontendRequestMap.filter((item) => !item.matched).map((item) => item.request);
  const contractAlignmentReport = {
    alignedRequests: frontendRequestMap.filter((item) => item.matched).length,
    totalRequests: frontendRequestMap.length,
    unmatchedRequests,
    apiContractCount: apiContracts.length,
    tableCount: erModel.length,
    eventCount: eventCatalog.length,
    crossRepoCoverage: structure && toArray(structure.crossRepoEdges).length > 0,
  };
  return {
    apiContracts,
    frontendRequestMap,
    erModel,
    eventCatalog,
    contractAlignmentReport,
  };
}

function extractBusinessTerms(config, dataContracts) {
  const explicitDomains = toArray(config && config.domains).map((item) => normalizeText(item.name || item.title || item.key));
  const fromTables = toArray(dataContracts.erModel).map((item) => titleFromToken(item.table.replace(/_?(tbl|table)$/i, '')));
  const fromApis = toArray(dataContracts.apiContracts).map((item) => {
    const parts = item.path.split('/').filter(Boolean);
    return titleFromToken(parts[parts.length - 1] || item.path);
  });
  return uniqueStrings([...explicitDomains, ...fromTables, ...fromApis]).slice(0, 12);
}

function deriveStateMachines(dataContracts) {
  const fromTables = toArray(dataContracts.erModel)
    .filter((item) => toArray(item.states).length > 0)
    .map((item) => ({
      entity: titleFromToken(item.table),
      states: uniqueStrings(item.states),
      source: item.table,
    }));
  const fromEvents = Object.values(
    toArray(dataContracts.eventCatalog).reduce((acc, event) => {
      const base = normalizeText(event.event).replace(/(Created|Updated|Cancelled|Completed|Approved)$/i, '');
      if (!base) return acc;
      const entity = titleFromToken(base);
      if (!acc[entity]) {
        acc[entity] = { entity, states: [], source: event.event };
      }
      if (/created$/i.test(event.event)) acc[entity].states.push('CREATED');
      if (/updated$/i.test(event.event)) acc[entity].states.push('UPDATED');
      if (/cancelled$/i.test(event.event)) acc[entity].states.push('CANCELLED');
      if (/completed$/i.test(event.event)) acc[entity].states.push('COMPLETED');
      if (/approved$/i.test(event.event)) acc[entity].states.push('APPROVED');
      return acc;
    }, {})
  ).map((item) => ({
    ...item,
    states: uniqueStrings(item.states),
  }));
  return uniqueBy([...fromTables, ...fromEvents], (item) => item.entity);
}

function deriveSemanticAssets(config, topology, structure, dataContracts) {
  const businessTerms = extractBusinessTerms(config, dataContracts);
  const businessActions = uniqueStrings([
    ...toArray(config && config.requirements),
    ...toArray(dataContracts.apiContracts).map((item) => item.businessAction || item.action),
    ...toArray(dataContracts.frontendRequestMap).map((item) => item.pageAction),
  ]).slice(0, 24);
  const frontendJourneys = uniqueBy(toArray(dataContracts.frontendRequestMap).map((item) => ({
    journey: normalizeText(item.pageAction) || '前端旅程',
    pageId: item.pageId,
    steps: uniqueStrings([
      `打开${item.pageAction}`,
      item.request,
      item.matched ? '后端返回结果' : '后端契约待补齐',
    ]),
    request: item.request,
    method: normalizeText(item.request).split(/\s+/)[0] || '',
    path: normalizeText(item.request).split(/\s+/).slice(1).join(' '),
    consumerRepoId: item.consumerRepoId,
    providerRepoId: item.providerRepoId,
    domainKey: item.domainKey,
    sourceLabel: item.sourceLabel,
    bindingType: item.bindingType,
  })), (item) => `${item.consumerRepoId}:${item.pageId}:${item.request}`);
  const stateMachines = deriveStateMachines(dataContracts);
  const aggregateCandidates = uniqueBy(
    [
      ...toArray(dataContracts.erModel).map((item) => ({
        name: item.businessLabel || titleFromToken(item.table),
        reasons: uniqueStrings([
          'has_table',
          toArray(item.states).length ? 'has_state_machine' : '',
          toArray(structure.crossRepoEdges).length ? 'cross_repo_usage' : '',
        ]),
        repoId: item.repoId,
        domainKey: item.domainKey,
      })),
      ...stateMachines.map((item) => ({
        name: item.entity,
        reasons: ['has_state_machine'],
      })),
    ],
    (item) => item.name
  );
  return {
    businessTerms,
    businessActions,
    frontendJourneys,
    stateMachines,
    aggregateCandidates,
  };
}

function deriveDddAssets(config, topology, structure, dataContracts, semantic) {
  const explicitDomains = toArray(config && config.domains).map((item) => ensureObject(item));
  const domainSeeds = explicitDomains.length
    ? explicitDomains.map((item) => ({
        key: normalizeText(item.key || item.name || item.title),
        name: normalizeText(item.name || item.title || item.key),
        capabilities: uniqueStrings(item.capabilities),
      }))
    : toArray(semantic.aggregateCandidates).map((item) => ({
        key: kebabCase(item.name),
        name: item.name,
        capabilities: [],
      }));

  const domains = uniqueBy(domainSeeds, (item) => item.key || item.name).map((seed) => {
    const domainKey = normalizeText(seed.key || kebabCase(seed.name));
    const domainEntry = DOMAIN_KEYWORD_CATALOG.find((item) => item.key === domainKey) || detectDomainByValue(seed.name || domainKey);
    const evidenceSet = collectDomainEvidenceSets(domainKey, {
      apiContracts: dataContracts.apiContracts,
      erModel: dataContracts.erModel,
      eventCatalog: dataContracts.eventCatalog,
      frontendJourneys: semantic.frontendJourneys,
      symbols: structure.symbols,
    });
    const relevantRepos = uniqueStrings([
      ...toArray(evidenceSet.apis).map((item) => item.repoId),
      ...toArray(evidenceSet.tables).map((item) => item.repoId),
      ...toArray(evidenceSet.pages).flatMap((item) => [item.consumerRepoId, item.providerRepoId]),
      ...toArray(evidenceSet.events).flatMap((item) => [item.repoId, ...toArray(item.consumers)]),
      ...toArray(evidenceSet.symbols)
        .filter((item) => ['page', 'controller', 'service', 'repository', 'entity'].includes(normalizeText(item.kind)))
        .map((item) => item.repoId),
    ]).filter(Boolean);
    const participatingRepos = relevantRepos.length
      ? relevantRepos
      : uniqueStrings(
          toArray(topology.repos)
            .filter((repo) => {
              const roleHint = normalizeText(repo.role);
              if (domainEntry?.key === 'ai_ordering') {
                return roleHint === 'frontend' || roleHint === 'backend' || roleHint === 'bff';
              }
              return roleHint === 'backend' || roleHint === 'frontend';
            })
            .map((repo) => repo.repoId)
        ).slice(0, 3);
    const relevantActions = uniqueStrings([
      ...toArray(evidenceSet.apis).map((item) => item.businessAction || item.action),
      ...toArray(semantic.businessActions).filter((action) =>
        toArray(evidenceSet.apis).some((item) => normalizeText(item.businessAction || item.action) === normalizeText(action)) ||
        toArray(evidenceSet.pages).some((item) => normalizeText(item.journey) === normalizeText(action))
      ),
      ...toArray(seed.capabilities),
      ...toArray(evidenceSet.pages).map((item) => item.journey),
    ]);
    const normalizedCapabilities = uniqueStrings(
      relevantActions
        .map((item) => normalizeCapabilityLabel(item, domainKey))
        .map((item) => refineCapabilityLabel(item, domainKey))
        .filter(Boolean)
    );
    const domainDisplay = compactDomainName(seed.name || resolveDomainDisplayName(domainKey) || titleFromToken(domainKey));
    const cleanedCapabilities = normalizedCapabilities.filter((item) => {
      if (item === `${domainDisplay}处理` && normalizedCapabilities.some((other) => other !== item && other.startsWith(domainDisplay))) {
        return false;
      }
      if (item === domainDisplay && normalizedCapabilities.some((other) => other !== item)) {
        return false;
      }
      return !isWeakCapabilityLabel(item);
    });
    const capabilities = cleanedCapabilities.length
      ? cleanedCapabilities.slice(0, 6)
      : [`${domainDisplay}处理`];
    const evidenceClasses = uniqueStrings([
      evidenceSet.apis.length ? 'api' : '',
      evidenceSet.tables.length ? 'table' : '',
      evidenceSet.events.length ? 'event' : '',
      evidenceSet.symbols.length ? 'code' : '',
      evidenceSet.pages.length ? 'page' : '',
    ]);
    return {
      name: seed.name || titleFromToken(seed.key),
      key: domainKey,
      type: participatingRepos.some((repoId) => {
        const repo = toArray(topology.repos).find((item) => item.repoId === repoId);
        return repo && repo.role === 'backend';
      }) ? 'core' : 'supporting',
      participatingRepos,
      capabilities,
      evidenceClasses,
      evidenceSummary: {
        apiCount: evidenceSet.apis.length,
        tableCount: evidenceSet.tables.length,
        eventCount: evidenceSet.events.length,
        pageCount: evidenceSet.pages.length,
        symbolCount: evidenceSet.symbols.length,
      },
      confidence: Number((Math.min(0.95, 0.55 + evidenceClasses.length * 0.1 + participatingRepos.length * 0.04)).toFixed(2)),
    };
  });

  const capabilityMap = domains.flatMap((domain) =>
    toArray(domain.capabilities).map((capability) => ({
      domain: domain.name,
      domainKey: domain.key,
      capability,
      participatingRepos: domain.participatingRepos,
    }))
  );

  const contextMap = uniqueBy(
    toArray(structure.crossRepoEdges).map((edge) => ({
      from: edge.fromRepo,
      to: edge.toRepo,
      relation: edge.edgeType === 'event' ? 'publishes_to' : edge.edgeType === 'dependency' ? 'depends_on' : 'calls',
    })),
    (item) => `${item.from}:${item.to}:${item.relation}`
  );

  const repoParticipationMap = domains.map((domain) => ({
    domain: domain.name,
    repos: domain.participatingRepos,
  }));

  const flowDomainAssignment = uniqueBy(
    toArray(semantic.frontendJourneys).map((journey) => {
      const matchedDomain = domains.find((domain) =>
        normalizeText(journey.journey).toLowerCase().includes(normalizeText(domain.name).toLowerCase()) ||
        toArray(domain.capabilities).some((capability) => normalizeText(journey.journey).includes(capability))
      ) || domains[0] || null;
      return {
        flow: journey.journey,
        domain: matchedDomain ? matchedDomain.name : '未归类',
      };
    }),
    (item) => `${item.flow}:${item.domain}`
  );

  return {
    domainModel: { domains },
    capabilityMap,
    contextMap,
    repoParticipationMap,
    flowDomainAssignment,
  };
}

function deriveEvidenceAssets(config, topology, structure, dataContracts, semantic, dddAssets) {
  const testSymbols = toArray(structure.symbols).filter((item) => item.kind === 'test' || /test|spec/i.test(normalizeText(item.path || item.symbol)));
  const evidenceCandidates = [
    ...toArray(structure.symbols)
      .filter((item) => item.kind !== 'test' && !/test|spec/i.test(normalizeText(item.path || item.symbol)))
      .map((item) => ({
      type: 'code',
      source: item.path || item.symbol,
      repoId: item.repoId,
      scope: item.kind,
      businessWeight: item.kind === 'page' ? 0.82 : item.kind === 'controller' || item.kind === 'service' ? 0.78 : 0.6,
      centrality: item.kind === 'controller' || item.kind === 'service' ? 0.72 : item.kind === 'page' ? 0.68 : 0.48,
      apiLink: item.kind === 'page' ? 0.74 : 0.42,
      domainKey: item.domainKey || '',
      })),
    ...toArray(dataContracts.apiContracts).map((item) => ({
      type: 'api',
      source: `${item.method} ${item.path}`,
      repoId: item.repoId,
      scope: item.action,
      businessWeight: 0.92,
      centrality: 0.78,
      apiLink: 1,
      domainKey: item.domainKey || '',
    })),
    ...toArray(dataContracts.erModel).map((item) => ({
      type: 'table',
      source: item.table,
      repoId: item.repoId,
      scope: 'er_model',
      businessWeight: 0.86,
      centrality: 0.66,
      apiLink: 0.58,
      domainKey: item.domainKey || '',
    })),
    ...toArray(dataContracts.eventCatalog).map((item) => ({
      type: 'event',
      source: item.event,
      repoId: item.repoId,
      scope: item.topic,
      businessWeight: 0.94,
      centrality: 0.7,
      apiLink: 0.72,
      domainKey: item.domainKey || '',
    })),
    ...toArray(config && config.requirements).map((item) => ({
      type: 'doc',
      source: item,
      repoId: null,
      scope: 'requirement',
      businessWeight: 0.8,
      centrality: 0.62,
      apiLink: 0.42,
    })),
  ];
  const evidenceIndex = rankEvidence(uniqueBy(evidenceCandidates.filter((item) => normalizeText(item.source)), (item) => `${item.type}:${item.repoId || ''}:${item.source}`));
  const diversifiedTopEvidence = uniqueBy(
    [
      ...uniqueBy(evidenceIndex, (item) => item.type),
      ...evidenceIndex,
    ],
    (item) => `${item.type}:${item.repoId || ''}:${item.source}`
  );
  const topEvidence = diversifiedTopEvidence.slice(0, 12);
  const overall = topEvidence.length
    ? Number((topEvidence.reduce((sum, item) => sum + Number(item.finalScore || 0), 0) / topEvidence.length).toFixed(4))
    : 0;
  const unmatchedRequests = toArray(dataContracts.contractAlignmentReport && dataContracts.contractAlignmentReport.unmatchedRequests);
  const negativeEvidence = [
    ...unmatchedRequests.map((request) => ({
      type: 'missing_contract',
      source: request,
      reason: 'frontend_request_without_backend_contract',
    })),
    ...testSymbols.map((item) => ({
      type: 'test_pollution_candidate',
      source: item.path || item.symbol,
      reason: 'tests_should_not_be_primary_evidence',
    })),
  ];
  const stitchedCrossRepoEvidence = uniqueBy(
    toArray(structure.crossRepoEdges).map((edge) => ({
      path: `${edge.fromRepo} -> ${edge.toRepo}`,
      edgeType: edge.edgeType,
      evidenceTypes: uniqueStrings(
        evidenceIndex
          .filter((item) => item.repoId === edge.fromRepo || item.repoId === edge.toRepo)
          .map((item) => item.type)
      ),
    })),
    (item) => `${item.path}:${item.edgeType}`
  );
  const visiblePayloads = [
    ...toArray(semantic.frontendJourneys),
    ...toArray(dddAssets.domainModel && dddAssets.domainModel.domains),
  ];
  const repoIds = uniqueStrings([
    ...toArray(config && config.repos).map((repo) => repo.repoId || repo.repo_slug),
    ...toArray(topology && topology.repos).map((repo) => repo.repoId || repo.repo_slug),
    ...toArray(evidenceIndex).map((item) => item.repoId),
    ...toArray(structure.crossRepoEdges).flatMap((edge) => [edge.fromRepo, edge.toRepo]),
  ]);
  const singleRepoProject = repoIds.length <= 1;
  const qualitySignals = {
    multiSource: uniqueStrings(evidenceIndex.map((item) => item.type)).length >= 3,
    testPollution: hasTestPollution(evidenceIndex, visiblePayloads),
    crossRepoClosedLoop: unmatchedRequests.length === 0 && (singleRepoProject || stitchedCrossRepoEvidence.length > 0),
    negativeEvidenceCount: negativeEvidence.length,
    repoCount: repoIds.length,
  };
  return {
    evidenceIndex,
    evidenceRanked: evidenceIndex,
    confidenceReport: {
      overall,
      reasons: uniqueStrings([
        qualitySignals.multiSource ? 'multi_source_evidence' : 'single_source_bias',
        qualitySignals.crossRepoClosedLoop ? 'cross_repo_closed_loop' : 'cross_repo_gap_detected',
        qualitySignals.testPollution ? 'test_pollution_detected' : 'test_pollution_absent',
      ]),
      sourceClasses: uniqueStrings(topEvidence.map((item) => item.type)),
      domainCoverage: toArray(dddAssets.domainModel && dddAssets.domainModel.domains).length,
    },
    negativeEvidence,
    stitchedCrossRepoEvidence,
    qualitySignals,
  };
}

function diagramRequiresBusinessFirst(diagram = {}) {
  const type = normalizeText(diagram.diagram_type);
  const title = normalizeText(diagram.title);
  if (type !== 'business_flow') return false;
  if (/行为地图/.test(title)) return true;
  if (/主流程|分支|异常|时序/.test(title)) return false;
  return false;
}

function isDomainSpecificApi(api, domainKey = '') {
  const pathText = normalizeText(api && api.path).toLowerCase();
  const actionText = normalizeText(api && (api.businessAction || api.action || api.source)).toLowerCase();
  if (normalizeText(domainKey) === 'ai_ordering') {
    return /\/api\/v1\.0\/ai\//.test(pathText) || /(aichat|ai ordering|ai协同|智能会话|流式|反馈纠偏|知识条目|prompt)/i.test(actionText);
  }
  return true;
}

function scoreApiForFlow(api, domainKey = '') {
  const pathText = normalizeText(api && api.path).toLowerCase();
  const actionText = normalizeText(api && (api.businessAction || api.action));
  let score = 0;
  if (normalizeText(api && api.domainKey) === normalizeText(domainKey)) score += 6;
  if (normalizeText(api && api.method).toUpperCase() === 'POST') score += 1;
  if (actionText) score += 2;
  if (normalizeText(domainKey) === 'ai_ordering') {
    if (/\/api\/v1\.0\/ai\//.test(pathText)) score += 8;
    if (!isDomainSpecificApi(api, domainKey)) score -= 12;
  }
  if (/session|create|submit|generate|insert|add|update|modify/.test(pathText)) score += 5;
  if (/stream|preview|feedback/.test(pathText)) score += 2;
  if (/list|paged|page|query|get/.test(pathText)) score += 3;
  if (/knowledge-vector/.test(pathText)) score -= 2;
  if (/remove|delete|disable|cancel/.test(pathText)) score -= 6;
  return score;
}

function scoreJourneyForApi(journey, api, domainKey = '') {
  if (!journey) return -Infinity;
  const journeyDomain = normalizeText(journey.domainKey);
  const apiDomain = normalizeText(api && api.domainKey);
  const requestText = normalizeText(journey.request);
  const apiRequest = api ? `${normalizeText(api.method)} ${normalizeText(api.path)}`.trim() : '';
  const pageTokens = semanticTokensForMatching(journey.pageId || journey.journey, 'page');
  const apiTokens = uniqueStrings([
    ...semanticTokensForMatching(api && api.path, 'api'),
    ...semanticTokensForMatching(api && api.action, 'api'),
  ]);
  let score = exactTokenOverlap(pageTokens, apiTokens) * 2;
  if (journeyDomain && apiDomain && journeyDomain === apiDomain) score += 6;
  if (journeyDomain && domainKey && journeyDomain === normalizeText(domainKey)) score += 4;
  if (requestText && apiRequest && normalizeText(requestText) === normalizeText(apiRequest)) score += 8;
  if (normalizeText(journey.bindingType) === 'explicit_frontend_api') score += 8;
  if (/AIOrderingAssistant|AI 协同助手/.test(normalizeText(journey.pageId || journey.sourceLabel)) && /\/api\/v1\.0\/ai\//i.test(normalizeText(api && api.path))) {
    score += 10;
  }
  if (isWeakFrontendEntry(journey.pageId || journey.journey)) score -= 8;
  return score;
}

function scoreTableForApi(table, api, domainKey = '') {
  if (!table) return -Infinity;
  const tableTokens = semanticTokensForMatching(table.table, 'generic');
  const apiTokens = uniqueStrings([
    ...semanticTokensForMatching(api && api.path, 'api'),
    ...semanticTokensForMatching(api && api.businessAction, 'api'),
  ]);
  const overlap = exactTokenOverlap(tableTokens, apiTokens);
  let score = overlap * 2;
  if (normalizeText(table.domainKey) === normalizeText(domainKey)) score += 3;
  if (/feedback/.test(normalizeText(api && api.path).toLowerCase()) && /feedback/.test(normalizeText(table.table).toLowerCase())) score += 4;
  if (/session|chat|stream/.test(normalizeText(api && api.path).toLowerCase()) && /conversation/.test(normalizeText(table.table).toLowerCase())) score += 4;
  if (/knowledge/.test(normalizeText(api && api.path).toLowerCase()) && /knowledge|prompt/.test(normalizeText(table.table).toLowerCase())) score += 4;
  return score;
}

function scoreEventForApi(event, api, domainKey = '') {
  if (!event) return -Infinity;
  const eventTokens = semanticTokensForMatching([event.event, event.topic].join(' '), 'generic');
  const apiTokens = uniqueStrings([
    ...semanticTokensForMatching(api && api.path, 'api'),
    ...semanticTokensForMatching(api && api.businessAction, 'api'),
  ]);
  const overlap = exactTokenOverlap(eventTokens, apiTokens);
  let score = overlap * 2;
  if (normalizeText(event.domainKey) === normalizeText(domainKey)) score += 3;
  if (/stream/.test(normalizeText(api && api.path).toLowerCase()) && /stream/.test(normalizeText(event.event).toLowerCase())) score += 4;
  if (/feedback/.test(normalizeText(api && api.path).toLowerCase()) && /feedback/.test(normalizeText(event.event).toLowerCase())) score += 4;
  return score;
}

function deriveFlowPathAssets(config, topology, dataContracts, semantic, dddAssets, evidenceAssets) {
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains);
  const candidateFlows = domains.flatMap((domain, domainIndex) => {
    const scopedDomainApis = toArray(dataContracts.apiContracts).filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key));
    const domainApis =
      normalizeText(domain.key) === 'ai_ordering'
        ? scopedDomainApis.filter((item) => isDomainSpecificApi(item, domain.key))
        : scopedDomainApis;
    const domainTables = toArray(dataContracts.erModel).filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key));
    const domainEvents = toArray(dataContracts.eventCatalog).filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key));
    const journeys = toArray(semantic.frontendJourneys).filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key));
    const inferredFrontendRepo =
      toArray(domain.participatingRepos).find((repoId) =>
        toArray(topology.repos).some((repo) => normalizeText(repo.repoId) === normalizeText(repoId) && normalizeText(repo.role) === 'frontend')
      ) ||
      (toArray(topology.repos).find((repo) => normalizeText(repo.role) === 'frontend') || {}).repoId ||
      '';
    const sortedApis = [...domainApis].sort((left, right) => scoreApiForFlow(right, domain.key) - scoreApiForFlow(left, domain.key));
    const primaryApi = sortedApis[0] || null;
    const primaryJourney =
      [...journeys].sort((left, right) => scoreJourneyForApi(right, primaryApi, domain.key) - scoreJourneyForApi(left, primaryApi, domain.key))[0] ||
      (inferredFrontendRepo
        ? {
            journey: `${compactDomainName(domain.name)}前端入口`,
            consumerRepoId: inferredFrontendRepo,
            providerRepoId: primaryApi?.repoId || '',
            domainKey: domain.key,
            synthetic: true,
          }
        : null);
    if (!primaryApi && !primaryJourney) return [];
    const flowId = `${domain.key || `domain-${domainIndex + 1}`}-main`;
    const actionLabel = primaryApi ? businessActionFromEndpoint(primaryApi) : normalizeText(primaryJourney?.journey) || domain.name;
    const primaryTable =
      [...domainTables].sort((left, right) => scoreTableForApi(right, primaryApi, domain.key) - scoreTableForApi(left, primaryApi, domain.key))[0] || null;
    const primaryEvent =
      [...domainEvents].sort((left, right) => scoreEventForApi(right, primaryApi, domain.key) - scoreEventForApi(left, primaryApi, domain.key))[0] || null;
    const steps = [
      primaryJourney
        ? {
            key: `${flowId}:page`,
            label: primaryJourney.journey,
            type: 'page',
            repoId: primaryJourney.consumerRepoId,
            domainKey: domain.key,
            businessLabel: primaryJourney.journey,
          }
        : null,
      primaryApi
        ? {
            key: `${flowId}:api`,
            label: `${primaryApi.method} ${primaryApi.path}`,
            type: 'api',
            repoId: primaryApi.repoId,
            domainKey: domain.key,
            businessLabel: apiStepBusinessLabel(primaryApi.businessAction || businessActionFromEndpoint(primaryApi), primaryApi.path),
          }
        : null,
      {
        key: `${flowId}:service`,
        label: actionLabel,
        type: 'business_action',
        repoId: primaryApi?.repoId || primaryJourney?.providerRepoId || toArray(domain.participatingRepos)[0] || '',
        domainKey: domain.key,
        businessLabel: actionLabel,
      },
      primaryTable
        ? {
            key: `${flowId}:table`,
            label: primaryTable.table,
            type: 'table',
            repoId: primaryTable.repoId,
            domainKey: domain.key,
            businessLabel: primaryTable.businessLabel || nounLabelFromTable(primaryTable.table),
          }
        : null,
      primaryEvent
        ? {
            key: `${flowId}:event`,
            label: primaryEvent.event,
            type: 'event',
            repoId: primaryEvent.repoId,
            domainKey: domain.key,
            businessLabel: primaryEvent.businessLabel || titleFromToken(primaryEvent.event),
          }
        : null,
    ].filter(Boolean);
    const repos = uniqueStrings([
      ...(domain.participatingRepos || []),
      primaryJourney?.consumerRepoId,
      primaryJourney?.providerRepoId,
      primaryApi?.repoId,
      primaryTable?.repoId,
      primaryEvent?.repoId,
    ]);
    const stepScore =
      steps.length +
      (steps.some((step) => step.type === 'page') ? 2 : 0) +
      (steps.some((step) => step.type === 'api') ? 2 : 0) +
      (steps.some((step) => step.type === 'table') ? 1.5 : 0) +
      (steps.some((step) => step.type === 'event') ? 4 : 0) +
      (repos.length > 1 ? 2 : 0);
    return [
      {
        flowId,
        title: `${domain.name} · ${actionLabel}`,
        domainKey: domain.key,
        flowType: 'core_thread',
        actionLabel,
        entryPoints: uniqueStrings([primaryJourney?.journey, primaryApi ? `${primaryApi.method} ${primaryApi.path}` : ''].filter(Boolean)),
        steps,
        repos,
        score: stepScore,
        alternateApis: sortedApis.filter((item) => `${item.method} ${item.path}` !== `${primaryApi?.method || ''} ${primaryApi?.path || ''}`),
        evidenceRefs: uniqueStrings(
          toArray(evidenceAssets.evidenceIndex)
            .filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key) || repos.includes(normalizeText(item.repoId)))
            .slice(0, 8)
            .map((item) => item.source)
        ),
      },
    ];
  });
  const flowPaths = candidateFlows
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .map((flow, index) => ({
      ...flow,
      flowType: index === 0 ? 'project_trunk' : 'core_thread',
    }));
  const branchPaths = flowPaths.flatMap((flow) =>
    toArray(flow.alternateApis)
      .filter((api) => /stream|preview|query|list|enable|disable|feedback/i.test(`${api.path} ${api.businessAction || api.action}`))
      .slice(0, 2)
      .map((api, index) => ({
        branchId: `${flow.flowId}:branch:${index + 1}`,
        parentFlowId: flow.flowId,
        title: `${flow.title} · ${api.businessAction || businessActionFromEndpoint(api)}分支`,
        domainKey: flow.domainKey,
        steps: [
          ...toArray(flow.steps).filter((step) => step.type === 'page').slice(0, 1),
          {
            key: `${flow.flowId}:branch:${index + 1}:api`,
            label: `${api.method} ${api.path}`,
            type: 'api',
            repoId: api.repoId,
            domainKey: flow.domainKey,
            businessLabel: apiStepBusinessLabel(api.businessAction || businessActionFromEndpoint(api), api.path),
          },
          {
            key: `${flow.flowId}:branch:${index + 1}:service`,
            label: api.businessAction || businessActionFromEndpoint(api),
            type: 'business_action',
            repoId: api.repoId,
            domainKey: flow.domainKey,
            businessLabel: api.businessAction || businessActionFromEndpoint(api),
          },
          ...toArray(flow.steps).filter((step) => step.type === 'table' || step.type === 'event').slice(0, 2),
        ],
        reason: 'alternative_or_feedback_branch',
      }))
  );
  const exceptionPaths = flowPaths.flatMap((flow) =>
    toArray(flow.alternateApis)
      .filter((api) => /feedback|remove|disable|delete|cancel/i.test(`${api.path} ${api.businessAction || api.action}`))
      .slice(0, 2)
      .map((api, index) => ({
        exceptionId: `${flow.flowId}:exception:${index + 1}`,
        parentFlowId: flow.flowId,
        title: `${flow.title} · ${api.businessAction || businessActionFromEndpoint(api)}异常补偿`,
        domainKey: flow.domainKey,
        steps: [
          ...toArray(flow.steps).filter((step) => step.type === 'page').slice(0, 1),
          {
            key: `${flow.flowId}:exception:${index + 1}:api`,
            label: `${api.method} ${api.path}`,
            type: 'api',
            repoId: api.repoId,
            domainKey: flow.domainKey,
            businessLabel: apiStepBusinessLabel(api.businessAction || businessActionFromEndpoint(api), api.path),
          },
          {
            key: `${flow.flowId}:exception:${index + 1}:service`,
            label: api.businessAction || businessActionFromEndpoint(api),
            type: 'business_action',
            repoId: api.repoId,
            domainKey: flow.domainKey,
            businessLabel: api.businessAction || businessActionFromEndpoint(api),
          },
          ...toArray(flow.steps).filter((step) => step.type === 'event' || step.type === 'table').slice(0, 2),
        ],
        reason: 'exception_or_recovery_path',
      }))
  );
  return {
    flowPaths,
    branchPaths,
    exceptionPaths,
  };
}

function deriveNodeAbstractions(flowAssets = {}, dataContracts = {}, structure = {}) {
  const abstractions = uniqueBy(
    [
      ...toArray(flowAssets.flowPaths).flatMap((flow) =>
        toArray(flow.steps).map((step) => ({
          nodeKey: step.key,
          technicalLabel: step.label,
          businessLabel: step.businessLabel || step.label,
          nodeType: step.type,
          domainKey: step.domainKey || flow.domainKey || '',
          repoId: step.repoId || '',
        }))
      ),
      ...toArray(dataContracts.apiContracts).map((contract) => ({
        nodeKey: `${contract.repoId}:${contract.method}:${contract.path}`,
        technicalLabel: `${contract.method} ${contract.path}`,
        businessLabel: businessActionFromEndpoint(contract),
        nodeType: 'api',
        domainKey: contract.domainKey || '',
        repoId: contract.repoId || '',
      })),
      ...toArray(dataContracts.erModel).map((table) => ({
        nodeKey: `${table.repoId}:${table.table}`,
        technicalLabel: table.table,
        businessLabel: table.businessLabel || nounLabelFromTable(table.table),
        nodeType: 'table',
        domainKey: table.domainKey || '',
        repoId: table.repoId || '',
      })),
      ...toArray(structure.symbols)
        .filter((item) => item.kind !== 'test')
        .slice(0, 120)
        .map((item) => ({
          nodeKey: `${item.repoId}:${item.symbol}`,
          technicalLabel: item.symbol,
          businessLabel: item.businessLabel || titleFromToken(item.symbol),
          nodeType: item.kind,
          domainKey: item.domainKey || '',
          repoId: item.repoId || '',
        })),
    ],
    (item) => item.nodeKey
  );
  return { nodeAbstractions: abstractions };
}

function stableNodeHash(value) {
  const text = normalizeText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function diagramNodeId(prefix, value) {
  const raw = normalizeText(value || prefix);
  const base = `${prefix}_${kebabCase(raw) || prefix}`.replace(/[^A-Za-z0-9_]/g, '_');
  return `${base}_${stableNodeHash(raw || prefix)}`;
}

function stepsHaveType(steps = [], type) {
  return toArray(steps).some((step) => normalizeText(step.type) === normalizeText(type));
}

function buildFlowMermaid(flowPath = {}) {
  const steps = toArray(flowPath.steps);
  const lines = ['flowchart LR'];
  steps.forEach((step) => {
    const nodeId = diagramNodeId(step.type, step.key || step.label);
    const label = step.businessLabel || step.label;
    lines.push(`  ${nodeId}["${label}"]`);
  });
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    if (!next) return;
    lines.push(`  ${diagramNodeId(step.type, step.key || step.label)} --> ${diagramNodeId(next.type, next.key || next.label)}`);
  });
  return lines.join('\n');
}

function summarizeLabels(items = [], fallback = '') {
  const labels = uniqueStrings(toArray(items).map((item) => normalizeText(item)).filter(Boolean)).slice(0, 3);
  return labels.length ? labels.join(' / ') : fallback;
}

function buildArchitectureMermaid(topology, dddAssets, dataContracts = {}, flowAssets = {}) {
  const lines = ['flowchart LR'];
  const repos = toArray(topology.repos);
  const frontendRepos = repos.filter((repo) => normalizeText(repo.role) === 'frontend');
  const backendRepos = repos.filter((repo) => ['backend', 'bff'].includes(normalizeText(repo.role)));
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains).slice(0, 6);
  const mainFlow = toArray(flowAssets.flowPaths)[0] || null;
  const mainDomain = domains.find((domain) => normalizeText(domain.key) === normalizeText(mainFlow && mainFlow.domainKey)) || domains[0] || null;
  const supportDomains = domains.filter((domain) => normalizeText(domain.key) !== normalizeText(mainDomain && mainDomain.key)).slice(0, 3);
  const preferredTableKeys = toArray(mainFlow && mainFlow.steps)
    .filter((step) => normalizeText(step.type) === 'table')
    .map((step) => normalizeText(step.label));
  const preferredEventKeys = toArray(mainFlow && mainFlow.steps)
    .filter((step) => normalizeText(step.type) === 'event')
    .map((step) => normalizeText(step.label));
  const tables = uniqueBy(
    [
      ...toArray(dataContracts.erModel).filter((item) => preferredTableKeys.includes(normalizeText(item.table))),
      ...toArray(dataContracts.erModel).filter((item) => normalizeText(item.domainKey) === normalizeText(mainDomain && mainDomain.key)),
      ...toArray(dataContracts.erModel),
    ].slice(0, 4),
    (item) => item.table
  );
  const events = uniqueBy(
    [
      ...toArray(dataContracts.eventCatalog).filter((item) => preferredEventKeys.includes(normalizeText(item.event))),
      ...toArray(dataContracts.eventCatalog).filter((item) => normalizeText(item.domainKey) === normalizeText(mainDomain && mainDomain.key)),
      ...toArray(dataContracts.eventCatalog),
    ].slice(0, 3),
    (item) => item.event
  );
  const frontendRepo = frontendRepos[0] || null;
  const backendRepo = backendRepos[0] || frontendRepos[0] || null;
  const frontendLabel = frontendRepo
    ? `${repoLabel(frontendRepo)}\\n${mainFlow && toArray(mainFlow.steps)[0] ? toArray(mainFlow.steps)[0].businessLabel || toArray(mainFlow.steps)[0].label : '业务入口'}`
    : '前端入口';
  const backendLabel = backendRepo ? `${repoLabel(backendRepo)}\\n业务编排 / 核心服务` : '后端编排';
  const dataLabel = `数据闭环 · ${summarizeLabels(tables.map((item) => item.businessLabel || nounLabelFromTable(item.table)), '核心业务数据')}`;
  const eventLabel = `事件闭环 · ${summarizeLabels(events.map((item) => item.businessLabel || humanizePathFragment(String(item.event).replace(/已执行$/g, ''))), '关键业务事件')}`;
  if (frontendRepo) {
    lines.push(`  ${diagramNodeId('repo', frontendRepo.repoId)}["${frontendLabel}"]`);
  }
  if (backendRepo) {
    lines.push(`  ${diagramNodeId('repo', backendRepo.repoId)}["${backendLabel}"]`);
  }
  if (mainDomain) {
    lines.push(`  ${diagramNodeId('domain', mainDomain.key)}["主干业务域 · ${mainDomain.name}"]`);
  }
  lines.push(`  ${diagramNodeId('hub', 'data') }["${dataLabel}"]`);
  lines.push(`  ${diagramNodeId('hub', 'event') }["${eventLabel}"]`);
  if (frontendRepo && mainDomain) {
    lines.push(`  ${diagramNodeId('repo', frontendRepo.repoId)} --> ${diagramNodeId('domain', mainDomain.key)}`);
  }
  if (mainDomain && backendRepo) {
    lines.push(`  ${diagramNodeId('domain', mainDomain.key)} --> ${diagramNodeId('repo', backendRepo.repoId)}`);
  }
  if (backendRepo) {
    lines.push(`  ${diagramNodeId('repo', backendRepo.repoId)} --> ${diagramNodeId('hub', 'data')}`);
    lines.push(`  ${diagramNodeId('repo', backendRepo.repoId)} --> ${diagramNodeId('hub', 'event')}`);
  }
  if (frontendRepo) {
    lines.push(`  ${diagramNodeId('hub', 'event')} --> ${diagramNodeId('repo', frontendRepo.repoId)}`);
  }
  supportDomains.forEach((domain) => {
    lines.push(`  ${diagramNodeId('domain', domain.key || domain.name)}["支撑域 · ${domain.name}"]`);
    if (backendRepo) {
      lines.push(`  ${diagramNodeId('repo', backendRepo.repoId)} --> ${diagramNodeId('domain', domain.key || domain.name)}`);
    } else if (mainDomain) {
      lines.push(`  ${diagramNodeId('domain', mainDomain.key)} --> ${diagramNodeId('domain', domain.key || domain.name)}`);
    }
  });
  tables.slice(0, 3).forEach((table) => {
    lines.push(`  ${diagramNodeId('hub', 'data')} --> ${diagramNodeId('table', table.table)}`);
    lines.push(`  ${diagramNodeId('table', table.table)}["${table.businessLabel || nounLabelFromTable(table.table)}"]`);
  });
  events.slice(0, 2).forEach((event) => {
    lines.push(`  ${diagramNodeId('hub', 'event')} --> ${diagramNodeId('event', event.event)}`);
    lines.push(`  ${diagramNodeId('event', event.event)}["${event.businessLabel || humanizePathFragment(String(event.event).replace(/已执行$/g, '')) || titleFromToken(event.event)}"]`);
  });
  if (mainFlow && stepsHaveType(mainFlow.steps, 'event') && frontendRepo && events[0]) {
    lines.push(`  ${diagramNodeId('event', events[0].event)} --> ${diagramNodeId('repo', frontendRepo.repoId)}`);
  }
  return lines.join('\n');
}

function buildSequenceMermaid(flowPath = {}) {
  const steps = toArray(flowPath.steps);
  const lines = ['sequenceDiagram'];
  const participants = uniqueBy(
    steps.map((step) => ({
      id: diagramNodeId(step.type, step.repoId || step.label),
      label:
        step.type === 'page'
          ? `前端页面:${step.businessLabel || step.label}`
          : step.type === 'api'
            ? `接口:${step.businessLabel || step.label}`
            : step.type === 'table'
              ? `数据库:${step.businessLabel || step.label}`
              : step.type === 'event'
                ? `事件:${step.businessLabel || step.label}`
                : `业务服务:${step.businessLabel || step.label}`,
    })),
    (item) => item.id
  );
  participants.forEach((participant) => {
    lines.push(`  participant ${participant.id} as ${participant.label}`);
  });
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    if (!next) return;
    lines.push(`  ${diagramNodeId(step.type, step.repoId || step.label)}->>${diagramNodeId(next.type, next.repoId || next.label)}: ${step.businessLabel || step.label}`);
  });
  return lines.join('\n');
}

function buildJourneyMermaid(flowPath = {}) {
  const steps = toArray(flowPath.steps);
  const lines = ['flowchart LR'];
  lines.push(`  ${diagramNodeId('actor', flowPath.title || 'journey')}["业务角色 / 页面触点"]`);
  steps.forEach((step) => {
    lines.push(`  ${diagramNodeId(step.type, step.key || step.label)}["${step.businessLabel || step.label}"]`);
  });
  if (steps[0]) {
    lines.push(`  ${diagramNodeId('actor', flowPath.title || 'journey')} --> ${diagramNodeId(steps[0].type, steps[0].key || steps[0].label)}`);
  }
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    if (!next) return;
    lines.push(`  ${diagramNodeId(step.type, step.key || step.label)} --> ${diagramNodeId(next.type, next.key || next.label)}`);
  });
  return lines.join('\n');
}

function buildDomainBehaviorMermaid(domain = {}) {
  const domainKey = normalizeText(domain.key) || kebabCase(domain.name || 'domain');
  const capabilities = toArray(domain.capabilities).slice(0, 6);
  const lines = [
    'flowchart LR',
    `  ${diagramNodeId('domain', domainKey)}["${normalizeText(domain.name) || '业务域'}"]`,
  ];
  capabilities.forEach((capability, index) => {
    const actorId = diagramNodeId('actor', `${domainKey}-${index}`);
    const capabilityId = diagramNodeId('capability', `${domainKey}-${kebabCase(capability) || index}`);
    lines.push(`  ${actorId}["业务角色${index + 1}"]`);
    lines.push(`  ${capabilityId}["${capability}"]`);
    lines.push(`  ${actorId} -->|发起| ${capabilityId}`);
    lines.push(`  ${capabilityId} -->|作用于| ${diagramNodeId('domain', domainKey)}`);
  });
  if (!capabilities.length) {
    const fallbackCapabilityId = diagramNodeId('capability', `${domainKey}-core-action`);
    lines.push(`  ${fallbackCapabilityId}["核心业务动作"]`);
    lines.push(`  ${fallbackCapabilityId} -->|作用于| ${diagramNodeId('domain', domainKey)}`);
  }
  return lines.join('\n');
}

function mermaidColumnType(type = '') {
  const normalized = normalizeText(type).toLowerCase();
  if (/bigint|int|tinyint|smallint/.test(normalized)) return 'int';
  if (/decimal|numeric|float|double/.test(normalized)) return 'float';
  if (/datetime|timestamp|date/.test(normalized)) return 'datetime';
  if (/text/.test(normalized)) return 'text';
  if (/bool/.test(normalized)) return 'boolean';
  return 'string';
}

function prioritizeErColumns(table = {}) {
  return [...toArray(table.columns)]
    .sort((left, right) => {
      const scoreColumn = (column = {}) => {
        const name = normalizeText(column.name).toLowerCase();
        let score = 0;
        if (name === normalizeText(table.pk).toLowerCase()) score += 10;
        if (/_id$/.test(name)) score += 8;
        if (/status|is_valid|is_deleted|submit_success|preview_generated/.test(name)) score += 6;
        if (/session_id|bill_type|category|create_time|update_time/.test(name)) score += 5;
        if (/message|reply|answer|correction/.test(name)) score += 2;
        return score;
      };
      return scoreColumn(right) - scoreColumn(left);
    })
    .slice(0, 6);
}

function inferRelationTarget(column, currentTable, tables = []) {
  const name = normalizeText(column && column.name).toLowerCase();
  const comment = normalizeText(column && column.comment);
  if (!/_id$/.test(name)) return null;
  if (/^(tenant_id|user_id|create_user_id|update_user_id)$/.test(name)) return null;
  if (name === 'conversation_log_id' || name === 'source_log_id') {
    return tables.find((table) => /conversation_log/i.test(normalizeText(table.table))) || null;
  }
  const base = name.replace(/_id$/i, '').replace(/^parent_/i, '').replace(/^source_/i, '');
  let best = null;
  let bestScore = 0;
  tables.forEach((table) => {
    if (!table || (!/^parent_/i.test(name) && normalizeText(table.table) === normalizeText(currentTable.table))) {
      return;
    }
    const tableTokens = semanticTokensForMatching([table.table, table.businessLabel, table.tableComment].join(' '), 'generic');
    const columnTokens = semanticTokensForMatching([base, comment].join(' '), 'generic');
    let score = exactTokenOverlap(columnTokens, tableTokens);
    if (normalizeText(table.table).includes(base)) score += 2;
    if (comment && normalizeText(table.businessLabel).includes(comment.replace(/ID|id/g, '').trim())) score += 1;
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? best : null;
}

function buildErMermaid(erModel = [], preferredDomainKey = '') {
  const lines = ['erDiagram'];
  const tables = [...toArray(erModel)]
    .sort((left, right) => {
      const scoreTable = (table = {}) => {
        let score = 0;
        if (normalizeText(table.domainKey) === normalizeText(preferredDomainKey)) score += 10;
        if (toArray(table.columns).length > 0) score += 4;
        if (toArray(table.states).length > 0) score += 2;
        if (/ai_|conversation|feedback|knowledge|prompt/.test(normalizeText(table.table))) score += 3;
        return score;
      };
      return scoreTable(right) - scoreTable(left);
    })
    .slice(0, 10);
  tables.forEach((table) => {
    lines.push(`  ${diagramNodeId('table', table.table)} {`);
    const columns = prioritizeErColumns(table);
    if (!columns.some((column) => normalizeText(column.name) === normalizeText(table.pk || 'id'))) {
      columns.unshift({ name: table.pk || 'id', type: 'bigint', comment: '主键' });
    }
    columns.forEach((column) => {
      const suffix = normalizeText(column.name) === normalizeText(table.pk || 'id') ? ' PK' : '';
      lines.push(`    ${mermaidColumnType(column.type)} ${column.name}${suffix}`);
    });
    lines.push('  }');
  });
  const relations = uniqueBy(
    tables.flatMap((table) =>
      prioritizeErColumns(table)
        .map((column) => ({ column, target: inferRelationTarget(column, table, tables), table }))
        .filter((item) => item.target)
        .map((item) => ({
          from: item.table.table,
          to: item.target.table,
          label: normalizeText(item.column.comment) || item.column.name,
        }))
    ),
    (item) => `${item.from}:${item.to}:${item.label}`
  );
  relations.forEach((relation) => {
    lines.push(`  ${diagramNodeId('table', relation.from)} ||--o{ ${diagramNodeId('table', relation.to)} : "${relation.label}"`);
  });
  return lines.join('\n');
}

function deriveDiagramAssets(config, topology, dataContracts, dddAssets, evidenceAssets, flowAssets = {}, nodeAssets = {}) {
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains);
  const mainFlow = toArray(flowAssets.flowPaths)[0] || null;
  const diagrams = [
    {
      diagram_type: 'product_architecture',
      title: `${normalizeText(config && config.projectName) || '项目'}多仓业务架构图`,
      scope_type: 'project',
      scope_key: 'project',
      content: buildArchitectureMermaid(topology, dddAssets, dataContracts, flowAssets),
      covered_evidence: toArray(evidenceAssets.evidenceIndex).slice(0, 8).map((item) => item.source),
    },
    mainFlow
      ? {
          diagram_type: 'business_flow',
          title: `${mainFlow.title} · 主流程图`,
          scope_type: 'project',
          scope_key: 'project',
          content: buildFlowMermaid(mainFlow),
          covered_evidence: mainFlow.evidenceRefs,
        }
      : null,
    mainFlow
      ? {
          diagram_type: 'core_logic',
          title: `${mainFlow.title} · 关键时序图`,
          scope_type: 'project',
          scope_key: 'project',
          content: buildSequenceMermaid(mainFlow),
          covered_evidence: mainFlow.evidenceRefs,
        }
      : null,
    mainFlow
      ? {
          diagram_type: 'module_flow',
          title: `${mainFlow.title} · 前后端联动旅程`,
          scope_type: 'project',
          scope_key: 'project',
          content: buildJourneyMermaid(mainFlow),
          covered_evidence: mainFlow.evidenceRefs,
        }
      : null,
    {
      diagram_type: 'database_er',
      title: `${normalizeText(config && config.projectName) || '项目'}数据关系图`,
      scope_type: 'project',
      scope_key: 'project',
      content: buildErMermaid(dataContracts.erModel, mainFlow && mainFlow.domainKey),
      covered_evidence: toArray(dataContracts.erModel).slice(0, 8).map((item) => item.table),
    },
    ...domains.map((domain) => ({
      diagram_type: 'business_domain',
      title: `${domain.name} · Context Map`,
      scope_type: 'domain',
      scope_key: domain.key,
      content: [
        'flowchart LR',
        `  ${diagramNodeId('domain', domain.key)}["${domain.name}"]`,
        ...toArray(domain.participatingRepos).map((repoId) => `  ${diagramNodeId('repo', repoId)}["${repoTail(repoId)}"]`),
        ...toArray(domain.participatingRepos).map((repoId) => `  ${diagramNodeId('repo', repoId)} --> ${diagramNodeId('domain', domain.key)}`),
        ...toArray(domain.capabilities).slice(0, 4).map((capability) => `  ${diagramNodeId('capability', `${domain.key}-${capability}`)}["${capability}"]`),
        ...toArray(domain.capabilities).slice(0, 4).map((capability) => `  ${diagramNodeId('domain', domain.key)} --> ${diagramNodeId('capability', `${domain.key}-${capability}`)}`),
      ].join('\n'),
      covered_evidence: toArray(evidenceAssets.evidenceIndex)
        .filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key))
        .slice(0, 8)
        .map((item) => item.source),
    })),
    ...domains.map((domain) => ({
      diagram_type: 'business_flow',
      title: `${domain.name} · 行为地图`,
      scope_type: 'domain',
      scope_key: domain.key,
      content: buildDomainBehaviorMermaid(domain),
      covered_evidence: toArray(evidenceAssets.evidenceIndex)
        .filter((item) => normalizeText(item.domainKey) === normalizeText(domain.key))
        .slice(0, 8)
        .map((item) => item.source),
    })),
  ].filter(Boolean);
  const repoRoles = uniqueStrings(toArray(topology && topology.repos).map((repo) => normalizeText(repo.role)));
  const diagramQualityReport = diagrams.map((diagram) => {
    const content = normalizeText(diagram.content);
    const title = normalizeText(diagram.title);
    const businessSpecificity = /业务|智能|单据|库存|财务|会话|反馈|预览|旅程|流程|订单|主数据|商品|分类/.test(`${title} ${content}`);
    const actorLoop =
      /前端页面|接口层|业务服务|数据库|事件总线|业务角色/.test(content) ||
      repoRoles.some((role) => ['frontend', 'backend', 'bff'].includes(role));
    const evidenceCoverage = toArray(diagram.covered_evidence).length > 0;
    const containsTestMarker = /test_asset|test|spec|fixture|mockmvc/i.test(content);
    let passed = false;
    switch (normalizeText(diagram.diagram_type)) {
      case 'product_architecture':
        passed = evidenceCoverage && repoRoles.includes('frontend') && (repoRoles.includes('backend') || repoRoles.includes('bff'));
        break;
      case 'business_flow':
        passed = businessSpecificity && evidenceCoverage && !containsTestMarker && Boolean(mainFlow && toArray(mainFlow.steps).length >= 4);
        break;
      case 'core_logic':
        passed = businessSpecificity && actorLoop && evidenceCoverage && !containsTestMarker;
        break;
      case 'module_flow':
        passed = businessSpecificity && actorLoop && evidenceCoverage && !containsTestMarker;
        break;
      case 'database_er':
        passed = evidenceCoverage && toArray(dataContracts.erModel).length > 0;
        break;
      case 'business_domain':
        passed = evidenceCoverage && /context map/i.test(title) && /capability_/i.test(content);
        break;
      default:
        passed = businessSpecificity && evidenceCoverage && !containsTestMarker;
        break;
    }
    return {
      diagram_key: diagram.diagram_type,
      diagram_type: diagram.diagram_type,
      title: diagram.title,
      passed,
      checks: {
        business_specificity: businessSpecificity,
        cross_repo_loop: actorLoop,
        evidence_coverage: evidenceCoverage,
      },
    };
  });
  return {
    diagramContext: {
      types: uniqueStrings(diagrams.map((item) => item.diagram_type)),
      scopes: uniqueStrings(diagrams.map((item) => item.scope_type)),
      primaryFlowId: mainFlow ? mainFlow.flowId : null,
      nodeAbstractionCount: toArray(nodeAssets && nodeAssets.nodeAbstractions).length,
    },
    diagramAssets: diagrams,
    diagramQualityReport,
  };
}

function deriveKnowledgeGraphProjection(config, dddAssets, flowAssets, diagramAssets, evidenceAssets, wikiAssets = null) {
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains);
  const capabilities = toArray(dddAssets.capabilityMap);
  const flows = toArray(flowAssets.flowPaths);
  const diagrams = toArray(diagramAssets.diagramAssets);
  const evidence = toArray(evidenceAssets.evidenceIndex).slice(0, 24);
  const nodes = [];
  const edges = [];
  const pages = toArray(wikiAssets && wikiAssets.wikiPages).map((page, index) => ({
    id: Number(index + 1),
    page_slug: page.pageSlug,
    title: page.title,
    page_type: page.pageType,
    source_uri: page.sourceUri,
  }));
  const addNode = (node) => {
    if (!nodes.some((item) => item.id === node.id)) {
      nodes.push(node);
    }
  };
  const addEdge = (source, target, type, label) => {
    if (!source || !target) return;
    const id = `${source}->${type}->${target}`;
    if (!edges.some((item) => item.id === id)) {
      edges.push({ id, source, target, type, label, metadata: {} });
    }
  };

  domains.forEach((domain) => {
    addNode({
      id: `domain:${domain.key}`,
      type: 'domain',
      label: domain.name,
      title: domain.name,
      status: 'ready',
      confidence: Number(domain.confidence || 0.8),
      source_files: [],
      source_apis: [],
      source_tables: [],
      page_slugs: [`10-domains/${kebabCase(domain.key || domain.name)}/00-summary`],
      evidence_count: Number(domain.evidenceSummary?.apiCount || 0) + Number(domain.evidenceSummary?.tableCount || 0),
      payload: domain,
    });
  });
  capabilities.forEach((capability) => {
    addNode({
      id: `capability:${kebabCase(`${capability.domainKey}:${capability.capability}`)}`,
      type: 'capability',
      label: capability.capability,
      title: capability.capability,
      status: 'ready',
      confidence: 0.82,
      source_files: [],
      source_apis: [],
      source_tables: [],
      page_slugs: [`10-domains/${kebabCase(capability.domainKey || capability.domain)}/00-summary`],
      evidence_count: 1,
      payload: capability,
    });
    addEdge(`domain:${capability.domainKey}`, `capability:${kebabCase(`${capability.domainKey}:${capability.capability}`)}`, 'domain_has_capability', 'has capability');
  });
  flows.forEach((flow) => {
    addNode({
      id: `flow:${flow.flowId}`,
      type: flow.flowType === 'project_trunk' ? 'flow' : 'journey',
      label: flow.title,
      title: flow.title,
      status: 'ready',
      confidence: 0.84,
      source_files: [],
      source_apis: [],
      source_tables: [],
      page_slugs: [`10-domains/${kebabCase(flow.domainKey)}/10-threads/${kebabCase(flow.flowId)}/00-summary`],
      evidence_count: toArray(flow.evidenceRefs).length,
      payload: flow,
    });
    addEdge(`domain:${flow.domainKey}`, `flow:${flow.flowId}`, 'domain_realizes_flow', 'realizes');
  });
  diagrams.forEach((diagram) => {
    addNode({
      id: `diagram:${diagram.diagram_type}:${diagram.scope_key}`,
      type: 'diagram',
      label: diagram.title,
      title: diagram.title,
      status: 'ready',
      confidence: 0.78,
      source_files: [],
      source_apis: [],
      source_tables: [],
      page_slugs: [],
      evidence_count: toArray(diagram.covered_evidence).length,
      payload: diagram,
    });
    if (diagram.scope_key && domains.some((domain) => domain.key === diagram.scope_key)) {
      addEdge(`domain:${diagram.scope_key}`, `diagram:${diagram.diagram_type}:${diagram.scope_key}`, 'domain_visualized_by', 'visualized');
    }
  });
  evidence.forEach((item) => {
    addNode({
      id: `evidence:${kebabCase(`${item.type}:${item.source}`)}`,
      type: 'evidence',
      label: item.source,
      title: item.source,
      status: 'ready',
      confidence: Number(item.finalScore || 0),
      source_files: [item.source],
      source_apis: item.type === 'api' ? [item.source] : [],
      source_tables: item.type === 'table' ? [item.source] : [],
      page_slugs: [],
      evidence_count: 1,
      payload: item,
    });
    if (item.domainKey) {
      addEdge(`domain:${item.domainKey}`, `evidence:${kebabCase(`${item.type}:${item.source}`)}`, 'domain_supported_by_evidence', 'supported by');
    }
  });
  return {
    run_id: null,
    snapshot_id: null,
    repo: {
      repo_source_id: null,
      repo_slug: normalizeText(config && config.projectCode),
      repo_url: null,
      branch: normalizeText(config && config.versionLine),
      commit_sha: null,
    },
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      object_counts: nodes.reduce((acc, node) => {
        acc[node.type] = Number(acc[node.type] || 0) + 1;
        return acc;
      }, {}),
      relation_counts: edges.reduce((acc, edge) => {
        acc[edge.type] = Number(acc[edge.type] || 0) + 1;
        return acc;
      }, {}),
      evidence_coverage: {
        object_count: nodes.length,
        covered_object_count: nodes.filter((node) => Number(node.evidence_count || 0) > 0).length,
        percent: nodes.length ? Number(((nodes.filter((node) => Number(node.evidence_count || 0) > 0).length / nodes.length) * 100).toFixed(2)) : 0,
      },
    },
    nodes,
    edges,
    pages,
    mermaid: buildFlowMermaid({ steps: [] }),
    warnings: [],
  };
}

function deriveWikiAssets(config, topology, semantic, dddAssets, evidenceAssets, diagramAssets) {
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains);
  const riskGapSections = [];
  if (!evidenceAssets.qualitySignals.multiSource) {
    riskGapSections.push({ type: 'risk', title: '多源证据不足', detail: '当前证据主要来自单一来源，正式发布前需要补齐 API、表和事件交叉证据。' });
  }
  if (!evidenceAssets.qualitySignals.crossRepoClosedLoop) {
    riskGapSections.push({ type: 'gap', title: '跨仓闭环未完成', detail: '存在前端请求未对齐后端契约，或跨仓证据链缺失。' });
  }
  const domainPages = domains.map((domain) => ({
    pageSlug: `domains/${kebabCase(domain.key || domain.name)}`,
    title: domain.name,
    pageType: 'domain',
    sourceUri: `deepwiki://domains/${kebabCase(domain.key || domain.name)}`,
    summary: `${domain.name}覆盖${toArray(domain.capabilities).join('、') || '核心业务能力'}，由 ${toArray(domain.participatingRepos).join('、')} 共同实现。`,
    participatingRepos: domain.participatingRepos,
    evidenceAsset: 'evidence_index',
    coveredDiagrams: toArray(diagramAssets.diagramAssets)
      .filter((item) => item.scope_key === domain.key)
      .map((item) => item.title),
  }));
  const journeyPages = toArray(semantic.frontendJourneys).map((journey) => ({
    pageSlug: `journeys/${kebabCase(journey.journey)}`,
    title: journey.journey,
    pageType: 'journey',
    sourceUri: `deepwiki://journeys/${kebabCase(journey.journey)}`,
    summary: `${journey.journey}包含 ${toArray(journey.steps).join(' -> ')}。`,
    participatingRepos: uniqueStrings([journey.consumerRepoId, journey.providerRepoId]),
    evidenceAsset: 'evidence_index',
  }));
  const wikiPages = [
    {
      pageSlug: 'overview/project',
      title: `${normalizeText(config && config.projectName) || '项目'}总览`,
      pageType: 'overview',
      sourceUri: 'deepwiki://overview/project',
      summary: `当前 snapshot 覆盖 ${domains.length} 个业务域、${toArray(diagramAssets.diagramAssets).length} 张关键图以及 ${toArray(evidenceAssets.evidenceIndex).length} 条证据。`,
      participatingRepos: uniqueStrings(toArray(topology.repos).map((repo) => repo.repoId)),
      evidenceAsset: 'evidence_index',
      children: domainPages.map((page) => page.pageSlug),
      riskGapSections,
    },
    ...domainPages,
    ...journeyPages,
  ];
  return {
    wikiPages,
    wikiIndex: {
      domains: domains.map((item) => item.name),
      pageCount: wikiPages.length,
      pageSlugs: wikiPages.map((item) => item.pageSlug),
    },
    riskGapSections,
  };
}

function deriveQualityAssets(config, evidenceAssets, dddAssets, diagramAssets, semantic, dataContracts, flowAssets = {}) {
  const passedDiagramCount = toArray(diagramAssets.diagramQualityReport).filter((diagram) => diagram.passed).length;
  const requiredDiagramPassCount = Math.min(3, Math.max(1, toArray(diagramAssets.diagramQualityReport).length));
  const visiblePayloads = [
    ...toArray(flowAssets.flowPaths),
    ...toArray(flowAssets.branchPaths),
    ...toArray(flowAssets.exceptionPaths),
    ...toArray(diagramAssets.diagramAssets),
  ];
  const visibleTestPollution = hasTestPollution(evidenceAssets.evidenceIndex, visiblePayloads);
  const businessFirstDiagrams = toArray(diagramAssets.diagramAssets).filter((diagram) => diagramRequiresBusinessFirst(diagram));
  const checks = [
    {
      checker: 'MissingEvidenceChecker',
      passed: toArray(evidenceAssets.evidenceIndex).length >= 4,
      blocking: true,
      detail: `evidence_count=${toArray(evidenceAssets.evidenceIndex).length}`,
    },
    {
      checker: 'TestPollutionChecker',
      passed: !visibleTestPollution,
      blocking: true,
      detail: `test_pollution=${visibleTestPollution}`,
    },
    {
      checker: 'DomainMisclassificationChecker',
      passed: !toArray(dddAssets.domainModel && dddAssets.domainModel.domains).some((domain) => /service|controller|repository/i.test(domain.name)),
      blocking: true,
      detail: 'domain names should stay business-first',
    },
    {
      checker: 'DiagramMismatchChecker',
      passed: passedDiagramCount >= requiredDiagramPassCount,
      blocking: true,
      detail: `diagram_passed=${passedDiagramCount}/${toArray(diagramAssets.diagramQualityReport).length}`,
    },
    {
      checker: 'LowConfidenceChecker',
      passed: Number(evidenceAssets.confidenceReport && evidenceAssets.confidenceReport.overall) >= 0.5,
      blocking: true,
      detail: `confidence=${Number(evidenceAssets.confidenceReport && evidenceAssets.confidenceReport.overall || 0)}`,
    },
    {
      checker: 'BusinessSpecificityChecker',
      passed: toArray(semantic.businessActions).length > 0 && toArray(semantic.businessTerms).length > 0 && toArray(flowAssets.flowPaths).length > 0,
      blocking: false,
      detail: `business_actions=${toArray(semantic.businessActions).length}`,
    },
    {
      checker: 'CrossRepoFlowCompletenessChecker',
      passed: evidenceAssets.qualitySignals.crossRepoClosedLoop,
      blocking: true,
      detail: `cross_repo_closed_loop=${evidenceAssets.qualitySignals.crossRepoClosedLoop}`,
    },
    {
      checker: 'FrontendBackendAlignmentChecker',
      passed: toArray(dataContracts.contractAlignmentReport && dataContracts.contractAlignmentReport.unmatchedRequests).length === 0,
      blocking: true,
      detail: `unmatched_requests=${toArray(dataContracts.contractAlignmentReport && dataContracts.contractAlignmentReport.unmatchedRequests).length}`,
    },
    {
      checker: 'DiagramBusinessActionChecker',
      passed: businessFirstDiagrams.length > 0 &&
        businessFirstDiagrams.every((diagram) => !/controller|service|repository|dto|test_asset/i.test(normalizeText(diagram.content))),
      blocking: true,
      detail: 'diagram should stay business-first instead of technical chain',
    },
  ];
  const blocked = checks.some((item) => item.blocking && !item.passed);
  return {
    qualityReport: {
      status: blocked ? 'review' : 'ready',
      score: Number((checks.filter((item) => item.passed).length / checks.length).toFixed(4)),
      summary: blocked ? 'quality gates blocked publish readiness' : 'quality gates ready for approval',
      checks,
    },
    gateSeed: [
      ...checks
        .filter((item) => item.blocking && !item.passed)
        .map((item) => ({
          gate_key: kebabCase(item.checker),
          decision_status: 'blocked',
          is_blocking: true,
          reason: item.detail,
          scope_type: 'snapshot',
          scope_key: '__snapshot__',
          source_type: 'checker',
          source_ref: item.checker,
        })),
      ...(blocked
        ? []
        : [
            {
              gate_key: 'publish_gate',
              decision_status: 'pass',
              is_blocking: false,
              reason: 'all_blocking_quality_checks_passed',
              scope_type: 'snapshot',
              scope_key: '__snapshot__',
              source_type: 'checker',
              source_ref: 'publish_gate',
            },
          ]),
    ],
  };
}

function deriveDerivationAssets(config, snapshot, dddAssets, evidenceAssets, dataContracts) {
  const domains = toArray(dddAssets.domainModel && dddAssets.domainModel.domains);
  const requirements = uniqueStrings(config && config.requirements).length
    ? uniqueStrings(config && config.requirements)
    : uniqueStrings(domains.flatMap((domain) => domain.capabilities));
  const formal = isPublishedSnapshot(snapshot);
  const impactMatrix = requirements.map((requirement) => {
    const normalizedRequirement = normalizeText(requirement).toLowerCase();
    const impactedDomains = domains
      .filter((domain) =>
        normalizeText(domain.name).toLowerCase().includes(normalizedRequirement) ||
        toArray(domain.capabilities).some((capability) => normalizeText(capability).includes(requirement))
      )
      .map((domain) => domain.name);
    const relatedApis = toArray(dataContracts.apiContracts)
      .filter((api) => normalizeText(api.action).includes(requirement) || normalizeText(api.path).toLowerCase().includes(normalizedRequirement))
      .map((api) => `${api.method} ${api.path}`);
    const relatedTables = toArray(dataContracts.erModel)
      .filter((table) => normalizeText(table.table).toLowerCase().includes(normalizedRequirement))
      .map((table) => table.table);
    const relatedEvents = toArray(dataContracts.eventCatalog)
      .filter((event) => normalizeText(event.event).toLowerCase().includes(normalizedRequirement))
      .map((event) => event.event);
    return {
      requirement,
      impactedDomains: impactedDomains.length ? impactedDomains : domains.slice(0, 1).map((domain) => domain.name),
      relatedApis,
      relatedTables,
      relatedEvents,
    };
  });
  const derivationLineage = {
    sourceSnapshotStatus: snapshot && snapshot.status ? snapshot.status : 'draft',
    sourceEvidenceCount: toArray(evidenceAssets.evidenceIndex).length,
    impactedDomains: uniqueStrings(impactMatrix.flatMap((item) => item.impactedDomains)),
    requirementCount: requirements.length,
  };
  return {
    impactMatrix,
    techSpecBundle: {
      mode: formal ? 'formal' : 'draft',
      summary: `${normalizeText(config && config.projectName) || '项目'}技术方案${formal ? '正式版' : '草案'}，覆盖 ${requirements.length} 条需求与 ${domains.length} 个业务域。`,
      apiContracts: toArray(dataContracts.apiContracts).map((item) => `${item.method} ${item.path}`),
      tables: toArray(dataContracts.erModel).map((item) => item.table),
      events: toArray(dataContracts.eventCatalog).map((item) => item.event),
      lineage: derivationLineage,
    },
    testPlanBundle: {
      mode: formal ? 'formal' : 'draft',
      summary: `${formal ? '正式' : '草案'}测试计划，覆盖页面、接口、表与事件闭环。`,
      cases: impactMatrix.map((item) => ({
        requirement: item.requirement,
        checkpoints: uniqueStrings([
          ...item.relatedApis.map((api) => `verify ${api}`),
          ...item.relatedTables.map((table) => `assert table ${table}`),
          ...item.relatedEvents.map((event) => `consume event ${event}`),
        ]),
      })),
      lineage: derivationLineage,
    },
    derivationLineage,
  };
}

module.exports = {
  normalizeText,
  toArray,
  uniqueStrings,
  deriveRepoUnderstanding,
  deriveStructureAssets,
  deriveDataContractAssets,
  deriveSemanticAssets,
  deriveDddAssets,
  deriveEvidenceAssets,
  deriveFlowPathAssets,
  deriveNodeAbstractions,
  deriveDiagramAssets,
  deriveKnowledgeGraphProjection,
  deriveWikiAssets,
  deriveQualityAssets,
  deriveDerivationAssets,
};
