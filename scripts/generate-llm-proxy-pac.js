#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const proxyHost = process.env.PAC_PROXY_HOST || '127.0.0.1';
const proxyPort = process.env.PAC_PROXY_PORT || '8899';
const outputPath =
  process.env.PAC_OUTPUT ||
  path.join(process.cwd(), 'docs', 'llm-egress-proxy.pac');

const llmHosts = [
  'api.openai.com',
  'chat.openai.com',
  'chatgpt.com',
  'ab.chatgpt.com',
  'api.anthropic.com',
  'openrouter.ai',
  'dashscope.aliyuncs.com',
  'generativelanguage.googleapis.com',
  'api.moonshot.ai',
  'api.moonshot.cn',
  'api.z.ai',
  'ollama.com',
];

const pac = `function FindProxyForURL(url, host) {
  var llmHosts = ${JSON.stringify(llmHosts)};
  for (var i = 0; i < llmHosts.length; i += 1) {
    if (dnsDomainIs(host, llmHosts[i]) || host === llmHosts[i]) {
      return "PROXY ${proxyHost}:${proxyPort}";
    }
  }
  return "DIRECT";
}
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, pac, 'utf8');
console.log(`PAC file generated: ${outputPath}`);
