#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const nodePath = process.execPath;
const runnerPath = path.join(projectRoot, 'scripts/local-service-runner.cjs');
const launchAgentsDir = path.join(os.homedir(), 'Library/LaunchAgents');
const runtimeDir = path.join(projectRoot, '.runtime/launchd');
const generatedPlistsDir = path.join(runtimeDir, 'generated-plists');
const domain = `gui/${process.getuid()}`;

const SERVICES = [
  {
    name: 'admin-ui',
    label: 'com.openclaw.ai-platform.admin-ui',
    description: 'AI Platform Admin UI',
    workingDirectory: path.join(projectRoot, 'admin-ui'),
    healthUrl: 'http://127.0.0.1:3000/deepwiki',
    port: 3000,
  },
  {
    name: 'ai-gateway',
    label: 'com.openclaw.ai-platform.ai-gateway',
    description: 'AI Platform AI Gateway',
    workingDirectory: path.join(projectRoot, 'ai-gateway'),
    healthUrl: 'http://127.0.0.1:3001/health',
    port: 3001,
  },
  {
    name: 'control-plane',
    label: 'com.openclaw.ai-platform.control-plane',
    description: 'AI Platform Control Plane',
    workingDirectory: path.join(projectRoot, 'control-plane'),
    healthUrl: 'http://127.0.0.1:3104/health',
    port: 3104,
  },
  {
    name: 'knowledge-base',
    label: 'com.openclaw.ai-platform.knowledge-base',
    description: 'AI Platform Knowledge Base',
    workingDirectory: path.join(projectRoot, 'knowledge-base'),
    healthUrl: 'http://127.0.0.1:8000/health',
    port: 8000,
  },
];
const CORE_SERVICE_NAMES = ['admin-ui', 'ai-gateway', 'control-plane'];

function usage() {
  console.log(
    [
      'Usage: node scripts/local-services.cjs <command> [service]',
      '',
      'Commands:',
      '  install      Write launchd agents, bootstrap them, and start immediately',
      '  uninstall    Stop launchd agents and remove the generated plists',
      '  start        Start one service or all services',
      '  stop         Stop one service or all services',
      '  restart      Restart one service or all services',
      '  status       Show launchd state and health checks',
      '  health       Print health check summary only',
      '  logs         Show log file locations',
      '',
      'Services:',
      `  ${SERVICES.map((service) => service.name).join(', ')}`,
      '',
      'Default scope:',
      `  ${CORE_SERVICE_NAMES.join(', ')} (knowledge-base is optional and can be targeted explicitly)`,
    ].join('\n')
  );
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function plistPathFor(service) {
  return path.join(launchAgentsDir, `${service.label}.plist`);
}

function generatedPlistPathFor(service) {
  return path.join(generatedPlistsDir, `${service.label}.plist`);
}

function stdoutLogPathFor(service) {
  return path.join(runtimeDir, `${service.name}.out.log`);
}

function stderrLogPathFor(service) {
  return path.join(runtimeDir, `${service.name}.err.log`);
}

function targetFor(service) {
  return `${domain}/${service.label}`;
}

function shellExec(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });
}

function resolveServices(name) {
  if (!name) {
    return SERVICES.filter((service) => CORE_SERVICE_NAMES.includes(service.name));
  }
  if (name === 'all') {
    return SERVICES;
  }
  const found = SERVICES.find((service) => service.name === name);
  if (!found) {
    throw new Error(`Unknown service "${name}"`);
  }
  return [found];
}

function buildPlist(service) {
  const env = {
    HOME: os.homedir(),
    PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    NODE_ENV: 'development',
  };
  const envXml = Object.entries(env)
    .map(([key, value]) => `      <key>${escapeXml(key)}</key>\n      <string>${escapeXml(value)}</string>`)
    .join('\n');

  const argsXml = [nodePath, runnerPath, service.name]
    .map((arg) => `      <string>${escapeXml(arg)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(service.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>NetworkState</key>
    <true/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>20</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutLogPathFor(service))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrLogPathFor(service))}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writePlists(services) {
  ensureDir(launchAgentsDir);
  ensureDir(runtimeDir);
  ensureDir(generatedPlistsDir);

  services.forEach((service) => {
    const plist = buildPlist(service);
    fs.writeFileSync(plistPathFor(service), plist, 'utf8');
    fs.writeFileSync(generatedPlistPathFor(service), plist, 'utf8');
  });
}

function launchctlPrint(service) {
  try {
    return shellExec('launchctl', ['print', targetFor(service)]);
  } catch (error) {
    return String(error?.stdout || error?.stderr || '').trim();
  }
}

function currentPid(service) {
  const output = launchctlPrint(service);
  const match = output.match(/\bpid = (\d+)/);
  return match ? Number(match[1]) : null;
}

function bootstrapService(service) {
  try {
    shellExec('launchctl', ['bootout', domain, plistPathFor(service)]);
  } catch {
    /* ignore */
  }
  shellExec('launchctl', ['bootstrap', domain, plistPathFor(service)]);
  shellExec('launchctl', ['enable', targetFor(service)]);
  shellExec('launchctl', ['kickstart', '-k', targetFor(service)]);
}

function bootoutService(service) {
  try {
    shellExec('launchctl', ['disable', targetFor(service)]);
  } catch {
    /* ignore */
  }
  try {
    shellExec('launchctl', ['bootout', domain, plistPathFor(service)]);
  } catch {
    /* ignore */
  }
}

function healthCheck(url) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: 1500,
      },
      (response) => {
        response.resume();
        const code = Number(response.statusCode || 0);
        resolve({
          ok: code >= 200 && code < 500,
          statusCode: code,
        });
      }
    );
    request.on('error', (error) => resolve({ ok: false, error: error.message }));
    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

async function printStatus(services, healthOnly = false) {
  for (const service of services) {
    const exists = fs.existsSync(plistPathFor(service));
    const pid = currentPid(service);
    const health = await healthCheck(service.healthUrl);
    const healthText = health.ok
      ? `healthy (${health.statusCode})`
      : `unhealthy${health.statusCode ? ` (${health.statusCode})` : ''}${health.error ? ` - ${health.error}` : ''}`;
    if (healthOnly) {
      console.log(`${service.name}: ${healthText}`);
      continue;
    }
    console.log(`${service.name}`);
    console.log(`  label: ${service.label}`);
    console.log(`  launch agent: ${exists ? plistPathFor(service) : 'not installed'}`);
    console.log(`  pid: ${pid || '-'}`);
    console.log(`  health: ${healthText}`);
    console.log(`  stdout: ${stdoutLogPathFor(service)}`);
    console.log(`  stderr: ${stderrLogPathFor(service)}`);
  }
}

function printLogs(services) {
  services.forEach((service) => {
    console.log(`${service.name}`);
    console.log(`  stdout: ${stdoutLogPathFor(service)}`);
    console.log(`  stderr: ${stderrLogPathFor(service)}`);
  });
}

async function main() {
  const command = String(process.argv[2] || '').trim();
  const serviceName = String(process.argv[3] || '').trim();

  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  const services = resolveServices(serviceName);

  if (command === 'install') {
    writePlists(services);
    services.forEach(bootstrapService);
    await printStatus(services);
    return;
  }

  if (command === 'uninstall') {
    services.forEach(bootoutService);
    services.forEach((service) => {
      try {
        fs.unlinkSync(plistPathFor(service));
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(generatedPlistPathFor(service));
      } catch {
        /* ignore */
      }
    });
    console.log(`Removed ${services.length} launch agent(s).`);
    return;
  }

  if (command === 'start') {
    services.forEach((service) => {
      if (!fs.existsSync(plistPathFor(service))) {
        writePlists([service]);
        bootstrapService(service);
        return;
      }
      shellExec('launchctl', ['enable', targetFor(service)]);
      shellExec('launchctl', ['kickstart', '-k', targetFor(service)]);
    });
    await printStatus(services);
    return;
  }

  if (command === 'stop') {
    services.forEach(bootoutService);
    await printStatus(services);
    return;
  }

  if (command === 'restart') {
    services.forEach((service) => {
      if (!fs.existsSync(plistPathFor(service))) {
        writePlists([service]);
        bootstrapService(service);
        return;
      }
      shellExec('launchctl', ['kickstart', '-k', targetFor(service)]);
    });
    await printStatus(services);
    return;
  }

  if (command === 'status') {
    await printStatus(services);
    return;
  }

  if (command === 'health') {
    await printStatus(services, true);
    return;
  }

  if (command === 'logs') {
    printLogs(services);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[local-services] ${error?.message || error}`);
  process.exit(1);
});
