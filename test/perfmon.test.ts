import { withMockFetch, responseBytes } from './helpers.js';
import {
  perfmonCollectCounterData,
  perfmonListCounter,
  perfmonListInstance,
  perfmonOpenSession,
  perfmonAddCounter,
  perfmonRemoveCounter,
  perfmonCollectSessionData,
  perfmonCloseSession,
} from '../src/perfmon.js';

describe('perfmon', () => {
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

  it('perfmonCollectCounterData parses counter values', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonCollectCounterDataResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ArrayOfCounterInfo>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsActive</Name>
          <Value>42</Value>
          <CStatus>0</CStatus>
        </item>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsCompleted</Name>
          <Value>9876</Value>
          <CStatus>0</CStatus>
        </item>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\RegisteredHardwarePhones</Name>
          <Value>150</Value>
          <CStatus>0</CStatus>
        </item>
      </ArrayOfCounterInfo>
    </ns:perfmonCollectCounterDataResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await perfmonCollectCounterData('10.0.0.1', '10.0.0.1', 'Cisco CallManager');
      expect(r).toHaveLength(3);
      expect(r[0]!.name).toContain('CallsActive');
      expect(r[0]!.value).toBe(42);
      expect(r[0]!.cStatus).toBe(0);
      expect(r[1]!.value).toBe(9876);
      expect(r[2]!.value).toBe(150);
    });

    await h.run(async (url) => {
      expect(url).toContain('/perfmonservice2/');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('perfmonListCounter parses object info', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonListCounterResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ArrayOfObjectInfo>
        <item>
          <Name>Cisco CallManager</Name>
          <MultiInstance>true</MultiInstance>
          <ArrayOfCounter>
            <item><Name>CallsActive</Name></item>
            <item><Name>CallsCompleted</Name></item>
          </ArrayOfCounter>
        </item>
        <item>
          <Name>Processor</Name>
          <MultiInstance>true</MultiInstance>
          <ArrayOfCounter>
            <item><Name>% CPU Time</Name></item>
          </ArrayOfCounter>
        </item>
      </ArrayOfObjectInfo>
    </ns:perfmonListCounterResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await perfmonListCounter('10.0.0.1', '10.0.0.1');
      expect(r).toHaveLength(2);
      expect(r[0]!.objectName).toBe('Cisco CallManager');
      expect(r[0]!.multiInstance).toBe(true);
      expect(r[0]!.counters).toEqual(['CallsActive', 'CallsCompleted']);
      expect(r[1]!.objectName).toBe('Processor');
      expect(r[1]!.counters).toEqual(['% CPU Time']);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('perfmonListInstance parses instance names', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonListInstanceResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ArrayOfInstanceInfo>
        <item><Name>CallManager</Name></item>
        <item><Name>_Total</Name></item>
      </ArrayOfInstanceInfo>
    </ns:perfmonListInstanceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await perfmonListInstance('10.0.0.1', '10.0.0.1', 'Cisco CallManager');
      expect(r).toEqual(['CallManager', '_Total']);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('perfmonOpenSession returns a session handle', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonOpenSessionResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <perfmonOpenSessionReturn>a1b2c3d4-e5f6-7890-abcd-ef1234567890</perfmonOpenSessionReturn>
    </ns:perfmonOpenSessionResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const handle = await perfmonOpenSession('10.0.0.1');
      expect(handle).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    await h.run(async (url) => {
      expect(url).toContain('/perfmonservice2/');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('perfmonAddCounter sends correct XML with counter names', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonAddCounterResponse xmlns:ns="http://schemas.cisco.com/ast/soap"/>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await perfmonAddCounter('10.0.0.1', 'session-uuid-123', [
        '\\\\10.0.0.1\\Cisco CallManager\\CallsActive',
        '\\\\10.0.0.1\\Cisco CallManager\\CallsCompleted',
      ]);
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString('utf8');
      expect(body).toContain('perfmonAddCounter');
      expect(body).toContain('<soap:SessionHandle>session-uuid-123</soap:SessionHandle>');
      expect(body).toContain('<soap:ArrayOfCounter>');
      expect(body).toContain('<soap:Counter><soap:Name>');
      expect(body).toContain('CallsActive');
      expect(body).toContain('CallsCompleted');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('perfmonCollectSessionData parses counter values', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonCollectSessionDataResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ArrayOfCounterInfo>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsActive</Name>
          <Value>7</Value>
          <CStatus>0</CStatus>
        </item>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsCompleted</Name>
          <Value>1234</Value>
          <CStatus>0</CStatus>
        </item>
      </ArrayOfCounterInfo>
    </ns:perfmonCollectSessionDataResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await perfmonCollectSessionData('10.0.0.1', 'session-uuid-123');
      expect(r).toHaveLength(2);
      expect(r[0]!.name).toContain('CallsActive');
      expect(r[0]!.value).toBe(7);
      expect(r[0]!.cStatus).toBe(0);
      expect(r[1]!.name).toContain('CallsCompleted');
      expect(r[1]!.value).toBe(1234);
    });

    await h.run(async (url) => {
      expect(url).toContain('/perfmonservice2/');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('perfmonRemoveCounter sends correct XML', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonRemoveCounterResponse xmlns:ns="http://schemas.cisco.com/ast/soap"/>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await perfmonRemoveCounter('10.0.0.1', 'session-uuid-123', [
        '\\\\10.0.0.1\\Cisco CallManager\\CallsActive',
      ]);
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString('utf8');
      expect(body).toContain('perfmonRemoveCounter');
      expect(body).toContain('<soap:SessionHandle>session-uuid-123</soap:SessionHandle>');
      expect(body).toContain('CallsActive');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('perfmonCloseSession succeeds', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonCloseSessionResponse xmlns:ns="http://schemas.cisco.com/ast/soap"/>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await perfmonCloseSession('10.0.0.1', 'session-uuid-123');
    });

    await h.run(async (url) => {
      expect(url).toContain('/perfmonservice2/');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('SOAP fault throws', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>PerfMon object not found</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(
        perfmonCollectCounterData('10.0.0.1', '10.0.0.1', 'NonExistentObject')
      ).rejects.toThrow(/fault/i);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });
});
