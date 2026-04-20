const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildDeepWikiKnowledgeGraph,
  buildDeepWikiPages,
  collectRepositoryInventory,
} = require('../src/deepwiki/repository');

function writeFixtureFile(root, relativePath, content) {
  const targetPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

test('collectRepositoryInventory ignores docs noise and normalizes controller routes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-repository-'));

  writeFixtureFile(
    tempRoot,
    'src/main/java/com/example/controller/AiChatController.java',
    `package com.example.controller;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/v1.0/ai")
public class AiChatController {
  @PostMapping(value = "/chat")
  public String chat() {
    return "ok";
  }
}
`
  );
  writeFixtureFile(
    tempRoot,
    'src/main/java/com/example/service/TokenValidService.java',
    `package com.example.service;

import org.springframework.stereotype.Service;

@Service
public class TokenValidService {}
`
  );
  writeFixtureFile(
    tempRoot,
    'src/main/java/com/example/repository/UserMapper.java',
    `package com.example.repository;

@Mapper
public interface UserMapper {}
`
  );
  writeFixtureFile(
    tempRoot,
    'src/main/java/com/example/entity/UserEntity.java',
    `package com.example.entity;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName("users")
public class UserEntity {}
`
  );
  writeFixtureFile(
    tempRoot,
    'db/schema.sql',
    `CREATE TABLE users (
  id BIGINT PRIMARY KEY
);
`
  );
  writeFixtureFile(tempRoot, 'docs/sql/basic_global_config_README.md', '# not a schema source\n');
  writeFixtureFile(tempRoot, 'archives/aiplan_erp数据库备份-20250410.zip', 'placeholder zip marker\n');
  writeFixtureFile(
    tempRoot,
    'docs/guide.md',
    'This guide mentions @Controller and service patterns, but it is not source code.\n'
  );
  writeFixtureFile(tempRoot, 'AGENTS.md', '# Workspace helper\n');
  writeFixtureFile(tempRoot, 'pom.xml', '<project></project>\n');

  const inventory = collectRepositoryInventory(tempRoot);

  assert.deepEqual(
    inventory.controllers.map((item) => item.path),
    ['src/main/java/com/example/controller/AiChatController.java']
  );
  assert.deepEqual(
    inventory.services.map((item) => item.path),
    ['src/main/java/com/example/service/TokenValidService.java']
  );
  assert.deepEqual(
    inventory.repositories.map((item) => item.path),
    ['src/main/java/com/example/repository/UserMapper.java']
  );
  assert.deepEqual(
    inventory.entities.map((item) => item.path),
    ['src/main/java/com/example/entity/UserEntity.java']
  );
  assert.ok(inventory.api_endpoints.includes('POST /api/v1.0/ai/chat'));
  assert.ok(!inventory.api_endpoints.includes('REQUEST /api/v1.0/ai/api/v1.0/ai'));
  assert.ok(!inventory.controllers.some((item) => /AGENTS|guide|pom/i.test(item.path)));
  assert.ok(!inventory.services.some((item) => /AGENTS|guide|pom/i.test(item.path)));
  assert.ok(!inventory.api_files.some((item) => /\.mdc?$/.test(item) || /guide/i.test(item)));
  assert.ok(!inventory.data_files.some((item) => /README|pom\.xml|\.zip$/i.test(item)));
  assert.ok(!inventory.sql_tables.some((item) => /README|pom\.xml|\.zip$/i.test(item.path)));

  const repo = {
    repo_url: 'https://example.com/demo.git',
    repo_slug: 'demo',
    branch: 'main',
    commit_sha: 'abc123def456',
  };
  const pages = buildDeepWikiPages({
    repo,
    inventory,
    moduleDigests: [],
    researchReport: '',
    focusPrompt: '',
    researchProvider: 'weelinking_openai_compatible',
    researchModel: '',
    outputProfile: 'engineering_architecture_pack',
    diagramProfile: 'full',
  });
  const dbPage = pages.find((page) => page.page_slug === '05-db-schema-and-data-model');
  assert.ok(dbPage);
  assert.match(dbPage.content, /## 表来源映射/);
  assert.match(dbPage.content, /users · db\/schema\.sql/);
  assert.match(dbPage.content, /## 实体到表映射/);
  assert.match(dbPage.content, /UserEntity -> users · src\/main\/java\/com\/example\/entity\/UserEntity\.java/);

  const graph = buildDeepWikiKnowledgeGraph({
    repo,
    inventory,
    pages,
    moduleDigests: [],
    researchProvider: 'weelinking_openai_compatible',
    researchModel: '',
    outputProfile: 'engineering_architecture_pack',
    diagramProfile: 'full',
  });
  assert.ok(!graph.objects.some((item) => /AGENTS|pom/i.test(item.title)));
});

test('collectRepositoryInventory classifies gradle multi-module repos and excludes noise modules', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-gradle-repository-'));

  writeFixtureFile(tempRoot, 'settings.gradle', 'include("lime-bill-service")\n');
  writeFixtureFile(tempRoot, 'build.gradle', 'plugins { id "java" }\n');
  writeFixtureFile(tempRoot, '.gitignore', 'build/\n');
  writeFixtureFile(tempRoot, 'gradlew', '#!/bin/sh\necho gradle\n');
  writeFixtureFile(tempRoot, '.cursor/rules.md', '# helper\n');
  writeFixtureFile(tempRoot, 'plans/roadmap.md', '# roadmap\n');
  writeFixtureFile(
    tempRoot,
    'lime-bill-service/src/main/java/com/example/LimeBillApplication.java',
    `package com.example;

import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class LimeBillApplication {}
`
  );
  writeFixtureFile(
    tempRoot,
    'lime-bill-service/src/main/java/com/example/controller/BillOrderController.java',
    `package com.example.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillOrderController {
  @GetMapping("/bill/orders")
  public String list() {
    return "ok";
  }
}
`
  );
  writeFixtureFile(
    tempRoot,
    'lime-bill-service/src/main/java/com/example/service/BillOrderService.java',
    `package com.example.service;

import org.springframework.stereotype.Service;

@Service
public class BillOrderService {}
`
  );
  writeFixtureFile(tempRoot, 'lime-bill-service/src/main/resources/application.yml', 'spring:\n  application:\n    name: lime-bill\n');

  const inventory = collectRepositoryInventory(tempRoot);

  assert.equal(inventory.package_manager, 'gradle');
  assert.ok(inventory.frameworks.includes('Spring'));
  assert.ok(inventory.frameworks.includes('Gradle'));
  assert.ok(inventory.frameworks.includes('Spring Boot'));
  assert.ok(inventory.entry_candidates.some((item) => item.endsWith('LimeBillApplication.java')));
  assert.ok(inventory.business_modules.some((item) => item.name === 'lime-bill-service'));
  assert.ok(!inventory.modules.some((item) => ['.cursor', 'plans', '.gitignore', 'gradlew'].includes(item.name)));
  assert.ok(inventory.noise_modules.includes('.cursor'));
  assert.ok(inventory.noise_modules.includes('plans'));
});

test('buildDeepWikiPages renders business-first module pages without dumping code blocks', () => {
  const inventory = {
    package_manager: 'gradle',
    frameworks: ['Spring', 'Spring Boot', 'Gradle'],
    top_languages: [{ language: 'Java', count: 20 }],
    modules: [
      {
        name: 'service:erp-bill',
        file_count: 3,
        source_files: [
          'service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java',
          'service/erp-bill/src/main/java/com/example/service/PurchaseInBillService.java',
          'service/erp-bill/src/main/java/com/example/entity/PurchaseInBill.java',
        ],
        key_files: [
          {
            path: 'service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java',
            preview: '@PostMapping("/purchase/in/create") public void create() {}',
          },
        ],
      },
    ],
    business_modules: [
      {
        name: 'service:erp-bill',
        file_count: 3,
        source_files: [
          'service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java',
          'service/erp-bill/src/main/java/com/example/service/PurchaseInBillService.java',
          'service/erp-bill/src/main/java/com/example/entity/PurchaseInBill.java',
        ],
        key_files: [
          {
            path: 'service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java',
            preview: '@PostMapping("/purchase/in/create") public void create() {}',
          },
        ],
      },
    ],
    api_endpoints: ['POST /purchase/in/create'],
    tables: ['purchase_in_bill'],
    controllers: [
      {
        path: 'service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java',
        class_name: 'PurchaseInBillController',
        endpoints: ['POST /purchase/in/create'],
      },
    ],
    services: [
      {
        path: 'service/erp-bill/src/main/java/com/example/service/PurchaseInBillService.java',
        class_name: 'PurchaseInBillService',
      },
    ],
    entities: [
      {
        path: 'service/erp-bill/src/main/java/com/example/entity/PurchaseInBill.java',
        class_name: 'PurchaseInBill',
        table_name: 'purchase_in_bill',
      },
    ],
    repositories: [],
    mapper_models: [],
    dto_models: [],
    vo_models: [],
    manifest_files: [],
    docs: [],
    api_files: ['service/erp-bill/src/main/java/com/example/controller/PurchaseInBillController.java'],
    data_files: ['db/schema.sql'],
    deploy_files: [],
    entry_candidates: ['service/erp-bill/src/main/java/com/example/ErpBillApplication.java'],
    repo_roles: ['service'],
    missing_repo_roles: ['frontend_view'],
    noise_modules: [],
    repo_units: [],
    package_json: null,
    feign_clients: [],
    sql_tables: [
      {
        path: 'db/schema.sql',
        table_name: 'purchase_in_bill',
        columns: ['id', 'status'],
        references: [],
      },
    ],
    readable_files: 3,
    total_files: 3,
  };
  const pages = buildDeepWikiPages({
    repo: {
      repo_url: 'https://example.com/erp.git',
      repo_slug: 'erp',
      branch: 'dev',
      commit_sha: 'abcdef123456',
    },
    inventory,
    moduleDigests: [],
    researchReport: '',
    focusPrompt: '',
    researchProvider: 'mock',
    researchModel: '',
    outputProfile: 'engineering_architecture_pack',
    diagramProfile: 'full',
  });

  const modulePage = pages.find((item) => item.page_slug === 'modules/service--erp-bill');
  assert.ok(modulePage);
  assert.match(modulePage.content, /## 业务职责/);
  assert.match(modulePage.content, /## 技术实现骨架/);
  assert.match(modulePage.content, /## 证据附录/);
  assert.doesNotMatch(modulePage.content, /```text/);
});
