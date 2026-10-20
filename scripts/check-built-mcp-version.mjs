import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageMetadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const tempRoot = mkdtempSync(join(tmpdir(), 'cucm-mcp-built-version-'));

try {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'built-version-check', version: '1.0.0' },
    },
  };
  const child = spawnSync(process.execPath, [join(packageRoot, 'build/index.js')], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      CUCM_MCP_TLS_MODE: 'strict',
      CUCM_MCP_STATE_PATH: join(tempRoot, 'state.json'),
    },
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
  });
  if (child.error?.code === 'ETIMEDOUT') throw new Error('built_handshake_timeout');
  if (child.error || child.status !== 0) throw new Error('built_handshake_process_failed');

  const response = (child.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find(frame => frame?.id === request.id);
  if (response?.result?.serverInfo?.version !== packageMetadata.version) {
    throw new Error('built_handshake_version_mismatch');
  }
  process.stdout.write('built_handshake_version=verified\n');
} catch (error) {
  const code = [
    'built_handshake_timeout',
    'built_handshake_process_failed',
    'built_handshake_version_mismatch',
  ].includes(String(error?.message))
    ? error.message
    : 'built_handshake_check_failed';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
