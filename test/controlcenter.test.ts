import { withMockFetch, responseBytes } from './helpers.js';
import { getServiceStatus } from '../src/controlcenter.js';

describe('controlcenter', () => {
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

  const serviceStatusXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:soapGetServiceStatusResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <soapGetServiceStatusReturn>
        <ServiceInfoList>
          <item>
            <ServiceName>Cisco CallManager</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>Service is running</ReasonCodeString>
            <StartTime>2024-01-01T12:00:00</StartTime>
            <UpTime>86400</UpTime>
            <UpTimeString>1 day</UpTimeString>
          </item>
          <item>
            <ServiceName>Cisco CDR Agent</ServiceName>
            <ServiceStatus>Stopped</ServiceStatus>
            <ReasonCode>-1</ReasonCode>
            <ReasonCodeString>Service stopped by admin</ReasonCodeString>
            <StartTime></StartTime>
            <UpTime>0</UpTime>
            <UpTimeString></UpTimeString>
          </item>
          <item>
            <ServiceName>Cisco DHCP Monitor</ServiceName>
            <ServiceStatus>Not Activated</ServiceStatus>
            <ReasonCode>-1</ReasonCode>
            <ReasonCodeString>Service not activated</ReasonCodeString>
            <StartTime></StartTime>
            <UpTime>0</UpTime>
            <UpTimeString></UpTimeString>
          </item>
        </ServiceInfoList>
      </soapGetServiceStatusReturn>
    </ns:soapGetServiceStatusResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('getServiceStatus parses service list', async () => {
    const h = withMockFetch(async () => {
      const r = await getServiceStatus('10.0.0.1');
      expect(r).toHaveLength(3);
      expect(r[0]!.serviceName).toBe('Cisco CallManager');
      expect(r[0]!.serviceStatus).toBe('Started');
      expect(r[0]!.upTime).toBe(86400);
      expect(r[0]!.reasonCodeString).toBe('Service is running');
      expect(r[1]!.serviceName).toBe('Cisco CDR Agent');
      expect(r[1]!.serviceStatus).toBe('Stopped');
      expect(r[2]!.serviceName).toBe('Cisco DHCP Monitor');
      expect(r[2]!.serviceStatus).toBe('Not Activated');
    });

    await h.run(async (url) => {
      expect(url).toContain('/controlcenterservice2/');
      return responseBytes(Buffer.from(serviceStatusXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('getServiceStatus with service name filter', async () => {
    const h = withMockFetch(async () => {
      await getServiceStatus('10.0.0.1', ['Cisco CallManager']);
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('Cisco CallManager');
      return responseBytes(Buffer.from(serviceStatusXml, 'utf8'), {
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
      <faultstring>Service query failed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(getServiceStatus('10.0.0.1')).rejects.toThrow(/fault/i);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });
});
