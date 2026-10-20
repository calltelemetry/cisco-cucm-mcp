import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createMcpServer } from '../src/server.js';

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

test('MCP initialize advertises the published package version', async () => {
  const previousTlsMode = process.env.CUCM_MCP_TLS_MODE;
  process.env.CUCM_MCP_TLS_MODE = 'strict';
  const server = createMcpServer();
  const client = new Client({ name: 'version-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getServerVersion()?.version).toBe(packageMetadata.version);
  } finally {
    await client.close().catch(() => {});
    await server.close();
    if (previousTlsMode === undefined) delete process.env.CUCM_MCP_TLS_MODE;
    else process.env.CUCM_MCP_TLS_MODE = previousTlsMode;
  }
});
