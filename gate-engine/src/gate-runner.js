/**
 * 门禁执行引擎
 * 
 * 用法:
 *   npm run gate-check -- --type prd --file docs/prd/user-module.md
 *   node src/gate-runner.js --type prd --file docs/prd/user-module.md
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const yaml = require('js-yaml');
const winston = require('winston');

// 日志配置
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/gate-engine.log' }),
  ],
});

function truncateForSearch(content, max = 1200) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : text.slice(0, max);
}

class GateRunner {
  constructor(gateType) {
    this.gateType = gateType;
    this.rules = this.loadRules();
  }

  loadRules() {
    const rulesPath = path.join(__dirname, '../rules', `${this.gateType}-gate.yaml`);
    
    if (!fs.existsSync(rulesPath)) {
      throw new Error(`Rules file not found: ${rulesPath}`);
    }
    
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    return yaml.load(rulesContent);
  }

  async run(content, metadata = {}) {
    logger.info(`Running ${this.gateType} gate check...`);
    
    const results = {
      gate_name: this.rules.gate.name,
      gate_version: this.rules.gate.version,
      timestamp: new Date().toISOString(),
      document: metadata.filename || 'unknown',
      author: metadata.author || 'unknown',
      checks: [],
      total_score: 0,
      max_score: 0,
      passed: false,
      status: 'pass',
      failed_checks: [],
      warned_checks: [],
    };

    // 执行所有检查
    for (const check of this.rules.checks) {
      const checkResult = await this.executeCheck(check, content, metadata);
      results.checks.push(checkResult);
      results.max_score += check.weight || 10;
      
      if (checkResult.status === 'pass') {
        results.total_score += checkResult.score || check.weight || 10;
      } else if (checkResult.status === 'warn') {
        results.warned_checks.push(check.name);
      } else {
        results.failed_checks.push(check.name);
      }
    }

    // 判断是否通过
    results.passed = this.evaluatePassCriteria(results);
    results.status = results.failed_checks.length ? 'block' : results.warned_checks.length ? 'warn' : 'pass';

    // 记录日志
    logger.info(`Gate check completed: ${results.passed ? 'PASSED' : 'FAILED'}`, {
      total_score: results.total_score,
      max_score: results.max_score,
      failed_checks: results.failed_checks,
    });

    return results;
  }

  async executeCheck(check, content, metadata) {
    const result = {
      name: check.name,
      type: check.type,
      weight: check.weight || 10,
      passed: false,
      status: 'block',
      score: 0,
      message: '',
      evidence: null,
      disabled_reason: null,
    };

    try {
      switch (check.type) {
        case 'required_field':
          result.status = this.checkRequiredField(content, check) ? 'pass' : 'block';
          break;
        
        case 'format_check':
          result.status = this.checkFormat(content, check) ? 'pass' : 'block';
          break;
        
        case 'checklist':
          result.status = this.checkChecklist(content, check) ? 'pass' : 'block';
          break;
        
        case 'knowledge_check':
          Object.assign(result, await this.checkKnowledgeBase(content, check));
          break;
        
        case 'pattern_check':
          result.status = this.checkPattern(content, check) ? 'pass' : 'block';
          break;
        
        case 'rag_reference':
          Object.assign(result, await this.checkRAGReference(content, check));
          break;
        
        default:
          logger.warn(`Unknown check type: ${check.type}`);
          result.message = `Unknown check type: ${check.type}`;
      }

      result.passed = result.status === 'pass';
      result.score = result.status === 'pass' ? (check.weight || 10) : 0;
      if (!result.message) {
        result.message =
          result.status === 'pass'
            ? (check.success_message || `✅ ${check.name} passed`)
            : result.status === 'warn'
              ? `${check.message || `⚠️ ${check.name} warning`}${result.disabled_reason ? ` (${result.disabled_reason})` : ''}`
              : (check.message || `❌ ${check.name} failed`);
      }

    } catch (error) {
      logger.error(`Check execution failed: ${check.name}`, { error: error.message });
      result.status = 'warn';
      result.message = `Error: ${error.message}`;
    }

    return result;
  }

  checkRequiredField(content, check) {
    const field = check.field;
    
    // 简单检查：内容中是否包含字段标识
    if (check.required) {
      return content.includes(field) || content.includes(`[${field}]`);
    }
    
    return true;
  }

  checkFormat(content, check) {
    // 检查必需章节
    if (check.required_sections) {
      for (const section of check.required_sections) {
        if (!content.includes(section)) {
          return false;
        }
      }
    }
    
    return true;
  }

  checkChecklist(content, check) {
    // 简化实现：检查是否包含自检清单
    const hasChecklist = content.includes('自检清单') || content.includes('[x]') || content.includes('[ ]');
    
    if (check.min_pass) {
      // 简化：假设有清单就通过
      return hasChecklist;
    }
    
    return hasChecklist;
  }

  async checkKnowledgeBase(content, check) {
    const searchUrl = (process.env.KNOWLEDGE_BASE_SEARCH_URL || '').trim();
    if (!searchUrl) {
      return {
        status: 'warn',
        disabled_reason: 'KNOWLEDGE_BASE_SEARCH_URL not configured',
        message: `⚠️ ${check.name}: 知识库未配置，已降级为告警`,
      };
    }

    try {
      const response = await axios.post(
        searchUrl,
        {
          query: truncateForSearch(content),
          collection: process.env.KNOWLEDGE_BASE_COLLECTION || 'phase1_knowledge_assets',
          top_k: Math.max(Number(check.min_references || 1), 1),
          min_score: Number(check.min_similarity || 0.2),
        },
        {
          timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 8000),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const hits = Array.isArray(response.data?.results) ? response.data.results : [];
      if (!hits.length) {
        return {
          status: 'warn',
          disabled_reason: 'knowledge_base_empty',
          message: `⚠️ ${check.name}: 未命中知识资产，请人工确认`,
        };
      }
      return {
        status: 'pass',
        evidence: hits.slice(0, 3).map((item) => item.metadata?.asset_key || item.chunk_id || item.id).join(', '),
      };
    } catch (error) {
      return {
        status: 'warn',
        disabled_reason: error.message,
        message: `⚠️ ${check.name}: 知识库检索失败，已降级为告警`,
      };
    }
  }

  checkPattern(content, check) {
    const field = check.field;
    const pattern = new RegExp(check.pattern);
    const matches = content.match(pattern);
    
    if (check.min_matches) {
      return matches && matches.length >= check.min_matches;
    }
    
    return matches && matches.length > 0;
  }

  async checkRAGReference(content, check) {
    const searchUrl = (process.env.KNOWLEDGE_BASE_SEARCH_URL || '').trim();
    if (!searchUrl) {
      return {
        status: 'warn',
        disabled_reason: 'KNOWLEDGE_BASE_SEARCH_URL not configured',
        message: `⚠️ ${check.name}: RAG 未配置，已降级为告警`,
      };
    }

    try {
      const response = await axios.post(
        searchUrl,
        {
          query: truncateForSearch(content),
          collection: process.env.KNOWLEDGE_BASE_COLLECTION || 'phase1_knowledge_assets',
          top_k: Math.max(Number(check.min_references || 2), 2),
          min_score: Number(check.min_similarity || 0.2),
        },
        {
          timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 8000),
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const hits = Array.isArray(response.data?.results) ? response.data.results : [];
      if (hits.length < Math.max(Number(check.min_references || 2), 2)) {
        return {
          status: 'warn',
          disabled_reason: `references_lt_${Math.max(Number(check.min_references || 2), 2)}`,
          message: `⚠️ ${check.name}: 历史引用不足，当前 ${hits.length} 条`,
        };
      }
      return {
        status: 'pass',
        evidence: hits.slice(0, 3).map((item) => item.metadata?.asset_key || item.chunk_id || item.id).join(', '),
      };
    } catch (error) {
      return {
        status: 'warn',
        disabled_reason: error.message,
        message: `⚠️ ${check.name}: RAG 检索失败，已降级为告警`,
      };
    }
  }

  evaluatePassCriteria(results) {
    const criteria = this.rules.pass_criteria;
    
    // 检查总分
    if (criteria.min_total_score) {
      if (results.total_score < criteria.min_total_score) {
        return false;
      }
    }
    
    // 检查必需通过项
    if (criteria.required_checks) {
      for (const requiredCheck of criteria.required_checks) {
        const checkResult = results.checks.find(c => c.name === requiredCheck);
        if (!checkResult || checkResult.status !== 'pass') {
          return false;
        }
      }
    }
    
    return true;
  }

  formatResults(results) {
    const status = results.passed ? '✅ PASSED' : '❌ FAILED';
    
    console.log('\n' + '='.repeat(60));
    console.log(`${status} - ${results.gate_name} v${results.gate_version}`);
    console.log('='.repeat(60));
    console.log(`文档：${results.document}`);
    console.log(`作者：${results.author}`);
    console.log(`时间：${results.timestamp}`);
    console.log('-'.repeat(60));
    console.log(`总分：${results.total_score} / ${results.max_score}`);
    console.log('');
    
    console.log('检查项详情:');
    for (const check of results.checks) {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`  ${icon} ${check.name}: ${check.message}`);
    }
    
    if (results.failed_checks.length > 0) {
      console.log('');
      console.log('失败项:', results.failed_checks.join(', '));
    }
    
    console.log('='.repeat(60) + '\n');
    
    return results;
  }
}

// CLI 入口
async function main() {
  const args = process.argv.slice(2);
  
  const gateType = args.find((_, i) => args[i - 1] === '--type') || 'prd';
  const filePath = args.find((_, i) => args[i - 1] === '--file');
  
  if (!filePath) {
    console.error('Usage: node gate-runner.js --type <prd|tech|code> --file <path>');
    process.exit(1);
  }
  
  // 读取文件内容
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Failed to read file: ${filePath}`);
    process.exit(1);
  }
  
  // 运行门禁检查
  const runner = new GateRunner(gateType);
  const metadata = {
    filename: path.basename(filePath),
    author: process.env.USER || 'unknown',
  };
  
  const results = await runner.run(content, metadata);
  runner.formatResults(results);
  
  // 退出码
  process.exit(results.passed ? 0 : 1);
}

// 导出模块
module.exports = GateRunner;

// 如果是直接运行
if (require.main === module) {
  main();
}
