import { withMockFetch, responseBytes } from './helpers.js';
import { startService, stopService, restartService, getStaticServiceListExtended } from '../src/controlcenter-ext.js';

describe('controlcenter-ext', () => {
  const savedEnv = { user: '', pass: '' };

  beforeEach(() => {
    savedEnv.user = process.env.CUCM_USERNAME ?? '';
    savedEnv.pass = process.env.CUCM_PASSWORD ?? '';
    process.env.CUCM_USERNAME = 'u';
    process.env.CUCM_PASSWORD = 'p';
  });

  afterEach(() => {
    process.env.CUCM_USERNAME = savedEnv.user;
    process.env.CUCM_PASSWORD = savedEnv.pass;
  });

  // soapDoControlServices (regular endpoint) for Start/Stop/Restart
  const controlResponseXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:soapDoControlServicesResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <soapDoControlServicesReturn>
        <ServiceInfoList>
          <item>
            <ServiceName>Cisco CallManager</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>Service operation completed</ReasonCodeString>
          </item>
        </ServiceInfoList>
      </soapDoControlServicesReturn>
    </ns:soapDoControlServicesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('startService sends ControlType=Start', async () => {
    const h = withMockFetch(async () => {
      const r = await startService('10.0.0.1', ['Cisco CallManager']);
      expect(r).toHaveLength(1);
      expect(r[0]!.serviceName).toBe('Cisco CallManager');
      expect(r[0]!.serviceStatus).toBe('Started');
    });

    await h.run(async (url, init) => {
      expect(url).toContain('/controlcenterservice2/services/ControlCenterServices');
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('soapDoControlServices');
      expect(body).toContain('<soap:ControlType>Start</soap:ControlType>');
      expect(body).toContain('Cisco CallManager');
      return responseBytes(Buffer.from(controlResponseXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('stopService sends ControlType=Stop', async () => {
    const h = withMockFetch(async () => {
      const r = await stopService('10.0.0.1', ['Cisco CDR Agent']);
      expect(r).toHaveLength(1);
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('<soap:ControlType>Stop</soap:ControlType>');
      expect(body).toContain('Cisco CDR Agent');
      return responseBytes(Buffer.from(controlResponseXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('restartService sends ControlType=Restart', async () => {
    const h = withMockFetch(async () => {
      const r = await restartService('10.0.0.1', ['Cisco CallManager']);
      expect(r).toHaveLength(1);
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('<soap:ControlType>Restart</soap:ControlType>');
      return responseBytes(Buffer.from(controlResponseXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('getStaticServiceListExtended parses extended service list', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:getStaticServiceListExtendedResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <getStaticServiceListExtendedReturn>
        <PrimaryNode>true</PrimaryNode>
        <SecondaryNode>false</SecondaryNode>
        <Services>
          <item>
            <ServiceName>Cisco CallManager</ServiceName>
            <ServiceType>Service</ServiceType>
            <Deployable>true</Deployable>
            <GroupName>CM Services</GroupName>
            <ServiceEnum>0</ServiceEnum>
          </item>
          <item>
            <ServiceName>Cisco DHCP Monitor</ServiceName>
            <ServiceType>Servlet</ServiceType>
            <Deployable>true</Deployable>
            <GroupName>Platform Services</GroupName>
            <ServiceEnum>12</ServiceEnum>
          </item>
        </Services>
      </getStaticServiceListExtendedReturn>
    </ns:getStaticServiceListExtendedResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await getStaticServiceListExtended('10.0.0.1');
      expect(r).toHaveLength(2);
      expect(r[0]!.serviceName).toBe('Cisco CallManager');
      expect(r[0]!.serviceType).toBe('Service');
      expect(r[0]!.deployable).toBe(true);
      expect(r[0]!.groupName).toBe('CM Services');
      expect(r[1]!.serviceName).toBe('Cisco DHCP Monitor');
    });

    await h.run(async (url) => {
      expect(url).toContain('ControlCenterServicesEx');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('service control with multiple services', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:soapDoControlServicesResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <soapDoControlServicesReturn>
        <ServiceInfoList>
          <item>
            <ServiceName>Cisco CallManager</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>OK</ReasonCodeString>
          </item>
          <item>
            <ServiceName>Cisco CTIManager</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>OK</ReasonCodeString>
          </item>
        </ServiceInfoList>
      </soapDoControlServicesReturn>
    </ns:soapDoControlServicesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await restartService('10.0.0.1', ['Cisco CallManager', 'Cisco CTIManager']);
      expect(r).toHaveLength(2);
      expect(r[0]!.serviceName).toBe('Cisco CallManager');
      expect(r[1]!.serviceName).toBe('Cisco CTIManager');
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('Cisco CallManager');
      expect(body).toContain('Cisco CTIManager');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('SOAP fault throws error', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Service operation failed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(startService('10.0.0.1', ['Bad Service'])).rejects.toThrow(/fault/i);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });
});
