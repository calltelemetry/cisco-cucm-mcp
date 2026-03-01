import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { CaptureStateStore } from '../src/state.js';

describe('CaptureStateStore', () => {
  let dir: string;
  let store: CaptureStateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'cucm-mcp-state-'));
    store = new CaptureStateStore({
      path: join(dir, 'state.json'),
      runningTtlMs: 1000,
      stoppedTtlMs: 1000,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should upsert, load, and set expiry', () => {
    const startedAt = new Date().toISOString();
    store.upsert({
      id: '1',
      host: 'x',
      startedAt,
      iface: 'eth0',
      fileBase: 'cap',
      remoteFilePath: '/var/log/active/platform/cli/cap.cap',
      remoteFileCandidates: ['/var/log/active/platform/cli/cap.cap'],
    });

    const loaded = store.load();
    expect(loaded.version).toBe(1);
    expect(loaded.captures['1']).toBeDefined();

    const rec = loaded.captures['1'];
    expect(rec?.expiresAt).toBeDefined();
  });
});
