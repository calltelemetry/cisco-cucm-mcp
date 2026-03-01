import { withMockFetch, responseBytes, buildMultipartRelated } from './helpers.js';
import { listNodeServiceLogs, selectLogs, getOneFile } from '../src/dime.js';

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
