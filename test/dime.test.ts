import { withMockFetch, responseBytes, buildMultipartRelated } from './helpers.js';
import { listNodeServiceLogs, selectLogs, getOneFile } from '../src/dime.js';
import { vi } from 'vitest';

describe('dime', () => {
  const savedEnv = { user: '', pass: '' };

  beforeEach(() => {
    savedEnv.user = process.env.CUCM_DIME_USERNAME ?? '';
    savedEnv.pass = process.env.CUCM_DIME_PASSWORD ?? '';
    process.env.CUCM_DIME_USERNAME = 'u';
    process.env.CUCM_DIME_PASSWORD = 'p';
  });

  afterEach(() => {
    process.env.CUCM_DIME_USERNAME = savedEnv.user;
    process.env.CUCM_DIME_PASSWORD = savedEnv.pass;
  });

  it('listNodeServiceLogs parses multi-node response', async () => {
    const boundary = 'MIMEBoundaryurn_uuid_TEST';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://schemas.cisco.com/ast/soap">
  <soapenv:Body>
    <ns1:listNodeServiceLogsResponse>
      <ns1:listNodeServiceLogsReturn>
        <ns1:name>node-a</ns1:name>
        <ns1:ServiceLog>
          <ns1:item>Cisco CallManager</ns1:item>
          <ns1:item>CTIManager</ns1:item>
        </ns1:ServiceLog>
      </ns1:listNodeServiceLogsReturn>
    </ns1:listNodeServiceLogsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const body = buildMultipartRelated(boundary, [
      { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from(xml, 'utf8') },
    ]);

    const h = withMockFetch(async () => {
      const r = await listNodeServiceLogs('192.168.125.10');
      expect(r).toHaveLength(1);
      expect(r[0]?.server).toBe('node-a');
      expect(r[0]?.count).toBe(2);
    });

    await h.run(async (url, init) => {
      expect(url).toContain('logcollectionservice2');
      const auth =
        (init.headers as Record<string, string>)?.Authorization ??
        (init.headers as Record<string, string>)?.authorization;
      expect(String(auth)).toMatch(/^Basic /);
      return responseBytes(body, {
        headers: {
          'content-type': `multipart/related; type="text/xml"; boundary=${boundary}`,
        },
      });
    });
  });

  it('selectLogs parses ServiceLogs file list', async () => {
    const boundary = 'MIMEBoundaryurn_uuid_TEST';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://schemas.cisco.com/ast/soap">
  <soapenv:Body>
    <ns1:selectLogFilesResponse>
      <ns1:ResultSet>
        <ns1:SchemaFileSelectionResult>
          <ns1:Node>
            <ns1:ServiceList>
              <ns1:ServiceLogs>
                <ns1:SetOfFiles>
                  <ns1:File>
                    <ns1:absolutepath>/var/log/active/cm/trace/SDL001.txt</ns1:absolutepath>
                    <ns1:filename>SDL001.txt</ns1:filename>
                  </ns1:File>
                </ns1:SetOfFiles>
              </ns1:ServiceLogs>
            </ns1:ServiceList>
          </ns1:Node>
        </ns1:SchemaFileSelectionResult>
      </ns1:ResultSet>
    </ns1:selectLogFilesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const body = buildMultipartRelated(boundary, [
      { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from(xml, 'utf8') },
    ]);

    const h = withMockFetch(async () => {
      const r = await selectLogs('192.168.125.10', {
        serviceLogs: ['Cisco CallManager'],
        fromDate: '10/04/22 11:00 AM',
        toDate: '10/04/22 11:05 AM',
        timezone: 'Client: (GMT+0:0)UTC',
      });
      expect(r).toHaveLength(1);
      expect(r[0]?.absolutePath).toBe('/var/log/active/cm/trace/SDL001.txt');
    });

    await h.run(async () =>
      responseBytes(body, {
        headers: {
          'content-type': `multipart/related; type="text/xml"; boundary=${boundary}`,
        },
      })
    );
  });

  it('selectLogs parses SystemLogs file list', async () => {
    const boundary = 'MIMEBoundaryurn_uuid_TEST';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://schemas.cisco.com/ast/soap">
  <soapenv:Body>
    <ns1:selectLogFilesResponse>
      <ns1:ResultSet>
        <ns1:SchemaFileSelectionResult>
          <ns1:Node>
            <ns1:ServiceList>
              <ns1:SystemLogs>
                <ns1:SetOfFiles>
                  <ns1:File>
                    <ns1:absolutepath>/var/log/active/syslog/ucm.log</ns1:absolutepath>
                    <ns1:filename>ucm.log</ns1:filename>
                  </ns1:File>
                </ns1:SetOfFiles>
              </ns1:SystemLogs>
            </ns1:ServiceList>
          </ns1:Node>
        </ns1:SchemaFileSelectionResult>
      </ns1:ResultSet>
    </ns1:selectLogFilesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const body = buildMultipartRelated(boundary, [
      { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from(xml, 'utf8') },
    ]);

    const h = withMockFetch(async () => {
      const r = await selectLogs('192.168.125.10', {
        systemLogs: ['Syslog'],
        fromDate: '10/04/22 11:00 AM',
        toDate: '10/04/22 11:05 AM',
        timezone: 'Client: (GMT+0:0)UTC',
      });
      expect(r).toHaveLength(1);
      expect(r[0]?.absolutePath).toBe('/var/log/active/syslog/ucm.log');
      expect(r[0]?.fileName).toBe('ucm.log');
    });

    await h.run(async () =>
      responseBytes(body, {
        headers: {
          'content-type': `multipart/related; type="text/xml"; boundary=${boundary}`,
        },
      })
    );
  });

  it('getOneFile returns non-XML part', async () => {
    const boundary = '----=_Part_999';
    const fileBytes = Buffer.from([10, 20, 30]);
    const body = buildMultipartRelated(boundary, [
      { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from('<x/>') },
      { headers: { 'Content-Type': 'application/octet-stream' }, body: fileBytes },
    ]);

    const h = withMockFetch(async () => {
      const r = await getOneFile('192.168.125.10', '/var/log/active/x.txt');
      expect([...r.data]).toEqual([10, 20, 30]);
    });

    await h.run(async () =>
      responseBytes(body, {
        headers: { 'content-type': `multipart/related; boundary="${boundary}"` },
      })
    );
  });
});

describe('selectLogsCluster', () => {
  const savedEnv: Record<string, string> = {};

  beforeEach(() => {
    savedEnv.user = process.env.CUCM_DIME_USERNAME ?? '';
    savedEnv.pass = process.env.CUCM_DIME_PASSWORD ?? '';
    savedEnv.sshUser = process.env.CUCM_SSH_USERNAME ?? '';
    savedEnv.sshPass = process.env.CUCM_SSH_PASSWORD ?? '';
    process.env.CUCM_DIME_USERNAME = 'u';
    process.env.CUCM_DIME_PASSWORD = 'p';
    process.env.CUCM_SSH_USERNAME = 'u';
    process.env.CUCM_SSH_PASSWORD = 'p';
  });

  afterEach(() => {
    process.env.CUCM_DIME_USERNAME = savedEnv.user;
    process.env.CUCM_DIME_PASSWORD = savedEnv.pass;
    process.env.CUCM_SSH_USERNAME = savedEnv.sshUser;
    process.env.CUCM_SSH_PASSWORD = savedEnv.sshPass;
    vi.restoreAllMocks();
  });

  it('fans out log queries to all discovered cluster nodes', async () => {
    // Mock showNetworkCluster (SSH)
    vi.doMock('../src/cli-tools.js', () => ({
      showNetworkCluster: vi.fn().mockResolvedValue({
        nodes: [
          { id: '1', hostname: 'pub', ipAddress: '10.0.0.1', ipv6Address: '', type: 'Publisher', hubOrSpoke: 'Hub', replicationStatus: '' },
          { id: '2', hostname: 'sub1', ipAddress: '10.0.0.2', ipv6Address: '', type: 'Subscriber', hubOrSpoke: 'Hub', replicationStatus: '' },
        ],
        raw: '',
      }),
    }));

    // Re-import to pick up the mock
    const { selectLogsCluster: clusterFn } = await import('../src/dime.js');

    const boundary = 'MIMEBoundaryurn_uuid_TEST';
    const makeXml = (path: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://schemas.cisco.com/ast/soap">
  <soapenv:Body>
    <ns1:selectLogFilesResponse>
      <ns1:ResultSet>
        <ns1:SchemaFileSelectionResult>
          <ns1:Node>
            <ns1:ServiceList>
              <ns1:ServiceLogs>
                <ns1:SetOfFiles>
                  <ns1:File>
                    <ns1:absolutepath>${path}</ns1:absolutepath>
                    <ns1:filename>trace.log</ns1:filename>
                  </ns1:File>
                </ns1:SetOfFiles>
              </ns1:ServiceLogs>
            </ns1:ServiceList>
          </ns1:Node>
        </ns1:SchemaFileSelectionResult>
      </ns1:ResultSet>
    </ns1:selectLogFilesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    let callCount = 0;
    const h = withMockFetch(async () => {
      const result = await clusterFn(
        '10.0.0.1',
        60,
        { serviceLogs: ['Cisco CallManager'] },
        { auth: { username: 'u', password: 'p' }, sshAuth: { username: 'u', password: 'p' } },
      );

      // Should have results for both nodes (10.0.0.1 is both publisher and node[0])
      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
      const allFiles = result.nodes.flatMap((n) => n.files);
      expect(allFiles.length).toBeGreaterThanOrEqual(2);
    });

    await h.run(async (_url) => {
      callCount++;
      const path = `/var/log/active/cm/trace/SDL${callCount}.txt`;
      const body = buildMultipartRelated(boundary, [
        { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from(makeXml(path), 'utf8') },
      ]);
      return responseBytes(body, {
        headers: { 'content-type': `multipart/related; type="text/xml"; boundary=${boundary}` },
      });
    });
  });

  it('handles partial node failures gracefully', async () => {
    vi.doMock('../src/cli-tools.js', () => ({
      showNetworkCluster: vi.fn().mockResolvedValue({
        nodes: [
          { id: '1', hostname: 'pub', ipAddress: '10.0.0.1', ipv6Address: '', type: 'Publisher', hubOrSpoke: 'Hub', replicationStatus: '' },
          { id: '2', hostname: 'sub1', ipAddress: '10.0.0.99', ipv6Address: '', type: 'Subscriber', hubOrSpoke: 'Hub', replicationStatus: '' },
        ],
        raw: '',
      }),
    }));

    const { selectLogsCluster: clusterFn } = await import('../src/dime.js');

    const boundary = 'MIMEBoundaryurn_uuid_TEST';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://schemas.cisco.com/ast/soap">
  <soapenv:Body>
    <ns1:selectLogFilesResponse>
      <ns1:ResultSet>
        <ns1:SchemaFileSelectionResult>
          <ns1:Node>
            <ns1:ServiceList>
              <ns1:ServiceLogs>
                <ns1:SetOfFiles>
                  <ns1:File>
                    <ns1:absolutepath>/var/log/active/cm/trace/SDL001.txt</ns1:absolutepath>
                    <ns1:filename>SDL001.txt</ns1:filename>
                  </ns1:File>
                </ns1:SetOfFiles>
              </ns1:ServiceLogs>
            </ns1:ServiceList>
          </ns1:Node>
        </ns1:SchemaFileSelectionResult>
      </ns1:ResultSet>
    </ns1:selectLogFilesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    let callCount = 0;
    const h = withMockFetch(async () => {
      const result = await clusterFn(
        '10.0.0.1',
        60,
        { serviceLogs: ['Cisco CallManager'] },
        { auth: { username: 'u', password: 'p' }, sshAuth: { username: 'u', password: 'p' } },
      );

      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
      // At least one node should have files, at least one should have an error
      const successNodes = result.nodes.filter((n) => n.files.length > 0);
      const errorNodes = result.nodes.filter((n) => n.error);
      expect(successNodes.length).toBeGreaterThanOrEqual(1);
      expect(errorNodes.length).toBeGreaterThanOrEqual(1);
    });

    await h.run(async (_url) => {
      callCount++;
      // First call succeeds, second fails
      if (callCount === 1) {
        const body = buildMultipartRelated(boundary, [
          { headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: Buffer.from(xml, 'utf8') },
        ]);
        return responseBytes(body, {
          headers: { 'content-type': `multipart/related; type="text/xml"; boundary=${boundary}` },
        });
      }
      // Simulate failure
      throw new Error('Connection refused');
    });
  });
});
