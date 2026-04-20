#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseHermesBaseUrl(text) {
  if (!text) return null;
  const match = text.match(/^\s*base_url:\s*"?(.*?)"?\s*$/m);
  return match ? match[1] : null;
}

function printSection(title) {
  console.log(`\n## ${title}`);
}

const homeDir = os.homedir();
const openclawConfigPath = path.join(homeDir, '.openclaw', 'openclaw.json');
const hermesConfigPath = path.join(homeDir, '.hermes', 'config.yaml');
const cursorSettingsPath = path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
const codexConfigPath = path.join(homeDir, '.codex', 'config.toml');

const openclaw = readJson(openclawConfigPath);
const cursor = readJson(cursorSettingsPath);
const hermesText = readText(hermesConfigPath);
const codexText = readText(codexConfigPath);

console.log('# 本机大模型客户端接入审计');
console.log(`生成时间: ${new Date().toISOString()}`);

printSection('OpenClaw');
const openclawBaseUrl = openclaw?.models?.providers?.qwen?.baseUrl || null;
console.log(`配置文件: ${openclawConfigPath}`);
console.log(`模型出口: ${openclawBaseUrl || '未发现'}`);
console.log(`状态: ${openclawBaseUrl && openclawBaseUrl.includes('127.0.0.1:3001') ? '已接入本机 AI 网关' : '未明确接入'}`);

printSection('Hermes');
const hermesBaseUrl = parseHermesBaseUrl(hermesText);
console.log(`配置文件: ${hermesConfigPath}`);
console.log(`模型出口: ${hermesBaseUrl || '未发现'}`);
console.log(`状态: ${hermesBaseUrl && hermesBaseUrl.includes('127.0.0.1:3001') ? '已接入本机 AI 网关' : '未明确接入'}`);

printSection('Cursor');
console.log(`配置文件: ${cursorSettingsPath}`);
console.log(`状态: 未在 settings.json 中发现模型网关出口配置，需走 Cursor 原生 Provider 配置或系统级代理`);
if (cursor && Object.keys(cursor).length) {
  console.log(`settings.json 键数量: ${Object.keys(cursor).length}`);
}

printSection('Codex');
console.log(`配置文件: ${codexConfigPath}`);
console.log(`配置摘要: ${codexText ? '存在本地配置，但未发现 base_url / gateway 出口设置' : '未发现配置文件'}`);
console.log('状态: 更可能依赖系统级代理或企业出口代理来拦截');

printSection('建议');
console.log('1. OpenClaw/Hermes 继续走 http://127.0.0.1:3001/v1。');
console.log('2. Cursor/Codex 先接入系统代理，统一导向 gateway-egress-proxy。');
console.log('3. 企业内网部署时，对直连外部 LLM 域名做阻断，仅允许公司网关出站。');
