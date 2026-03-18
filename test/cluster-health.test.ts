import { withMockFetch, responseBytes } from './helpers.js';
import { clusterHealthCheck } from '../src/cluster-health.js';

// ---------- XML fixtures (reuse shapes from risport/perfmon/controlcenter tests) ----------

const risXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:selectCmDeviceResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ns:selectCmDeviceReturn>
        <SelectCmDeviceResult>
          <TotalDevicesFound>3</TotalDevicesFound>
          <CmNodes>
            <item>
              <ReturnCode>Ok</ReturnCode>
              <Name>cucm15-pub</Name>
              <CmDevices>
                <item>
                  <Name>SEP001122334455</Name>
                  <IPAddress><item><IP>10.0.1.100</IP><IPAddrType>ipv4</IPAddrType></item></IPAddress>
                  <Status>Registered</Status>
                  <Protocol>SIP</Protocol>
                </item>
                <item>
                  <Name>SEP665544332211</Name>
                  <IPAddress><item><IP>10.0.1.101</IP><IPAddrType>ipv4</IPAddrType></item></IPAddress>
                  <Status>Registered</Status>
                  <Protocol>SIP</Protocol>
                </item>
              </CmDevices>
            </item>
            <item>
              <ReturnCode>Ok</ReturnCode>
              <Name>cucm15-sub</Name>
              <CmDevices>
                <item>
                  <Name>SEPAABBCCDDEEFF</Name>
                  <IPAddress><item><IP>10.0.2.50</IP><IPAddrType>ipv4</IPAddrType></item></IPAddress>
                  <Status>UnRegistered</Status>
                  <Protocol>SIP</Protocol>
                </item>
              </CmDevices>
            </item>
          </CmNodes>
        </SelectCmDeviceResult>
      </ns:selectCmDeviceReturn>
    </ns:selectCmDeviceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const perfmonXml = `<?xml version="1.0"?>
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
          <Name>\\\\10.0.0.1\\Cisco CallManager\\RegisteredHardwarePhones</Name>
          <Value>150</Value>
          <CStatus>0</CStatus>
        </item>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\RegisteredOtherStationDevices</Name>
          <Value>25</Value>
          <CStatus>0</CStatus>
        </item>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsCompleted</Name>
          <Value>9876</Value>
          <CStatus>0</CStatus>
        </item>
      </ArrayOfCounterInfo>
    </ns:perfmonCollectCounterDataResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const controlCenterXml = `<?xml version="1.0"?>
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
            <ServiceName>Cisco CTIManager</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>Service is running</ReasonCodeString>
            <StartTime>2024-01-01T12:00:00</StartTime>
            <UpTime>86400</UpTime>
            <UpTimeString>1 day</UpTimeString>
          </item>
          <item>
            <ServiceName>Cisco Tftp</ServiceName>
            <ServiceStatus>Started</ServiceStatus>
            <ReasonCode>0</ReasonCode>
            <ReasonCodeString>Service is running</ReasonCodeString>
            <StartTime>2024-01-01T12:00:00</StartTime>
            <UpTime>86400</UpTime>
            <UpTimeString>1 day</UpTimeString>
          </item>
          <item>
            <ServiceName>Cisco RIS Data Collector</ServiceName>
            <ServiceStatus>Stopped</ServiceStatus>
            <ReasonCode>-1</ReasonCode>
            <ReasonCodeString>Service stopped</ReasonCodeString>
            <StartTime></StartTime>
            <UpTime>0</UpTime>
            <UpTimeString></UpTimeString>
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
        </ServiceInfoList>
      </soapGetServiceStatusReturn>
    </ns:soapGetServiceStatusResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

// ---------- Helper: route mock fetch by URL path ----------

function mockFetchRouter(overrides?: {
  risHandler?: (url: string, init: RequestInit) => Response | Promise<Response>;
  perfmonHandler?: (url: string, init: RequestInit) => Response | Promise<Response>;
  controlCenterHandler?: (url: string, init: RequestInit) => Response | Promise<Response>;
}) {
  return (url: string, init: RequestInit): Response | Promise<Response> => {
    if (url.includes('/realtimeservice2/')) {
      if (overrides?.risHandler) return overrides.risHandler(url, init);
      return responseBytes(Buffer.from(risXml, 'utf8'), { headers: { 'content-type': 'text/xml' } });
    }
    if (url.includes('/perfmonservice2/')) {
      if (overrides?.perfmonHandler) return overrides.perfmonHandler(url, init);
      return responseBytes(Buffer.from(perfmonXml, 'utf8'), { headers: { 'content-type': 'text/xml' } });
    }
    if (url.includes('/controlcenterservice2/')) {
      if (overrides?.controlCenterHandler) return overrides.controlCenterHandler(url, init);
      return responseBytes(Buffer.from(controlCenterXml, 'utf8'), { headers: { 'content-type': 'text/xml' } });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

// ---------- Tests ----------

describe('clusterHealthCheck', () => {
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

  it('all 3 sub-queries succeed — full result', async () => {
    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      // No errors
      expect(r.errors).toHaveLength(0);

      // Devices
      expect(r.devices).not.toBeNull();
      expect(r.devices!.totalFound).toBe(3);
      expect(r.devices!.registered).toBe(2);
      expect(r.devices!.unregistered).toBe(1);
      expect(r.devices!.byNode).toHaveLength(2);
      expect(r.devices!.byNode[0]!.name).toBe('cucm15-pub');
      expect(r.devices!.byNode[0]!.devicesFound).toBe(2);
      expect(r.devices!.byNode[1]!.name).toBe('cucm15-sub');
      expect(r.devices!.byNode[1]!.devicesFound).toBe(1);

      // Counters
      expect(r.counters).not.toBeNull();
      expect(r.counters!.callsActive).toBe(42);
      expect(r.counters!.registeredHardwarePhones).toBe(150);
      expect(r.counters!.registeredOtherStationDevices).toBe(25);
      expect(r.counters!.raw).toHaveLength(4);

      // Services
      expect(r.services).not.toBeNull();
      expect(r.services!.total).toBe(5);
      expect(r.services!.started).toBe(3);
      expect(r.services!.stopped).toBe(2);
      expect(r.services!.critical).toHaveLength(4);
      // Cisco RIS Data Collector should be in critical list and stopped
      const risCritical = r.services!.critical.find((s) => s.serviceName === 'Cisco RIS Data Collector');
      expect(risCritical).toBeDefined();
      expect(risCritical!.serviceStatus).toBe('Stopped');
    });

    await h.run(mockFetchRouter());
  });

  it('one query fails — partial result with error in errors[]', async () => {
    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      // Should have exactly 1 error (perfmon failed)
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain('counters:');
      expect(r.errors[0]).toContain('PerfMon exploded');

      // Devices should still be populated
      expect(r.devices).not.toBeNull();
      expect(r.devices!.totalFound).toBe(3);

      // Counters should be null
      expect(r.counters).toBeNull();

      // Services should still be populated
      expect(r.services).not.toBeNull();
      expect(r.services!.total).toBe(5);
    });

    await h.run(
      mockFetchRouter({
        perfmonHandler: () => {
          throw new Error('PerfMon exploded');
        },
      }),
    );
  });

  it('all queries fail — null sections with 3 errors', async () => {
    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      expect(r.errors).toHaveLength(3);
      expect(r.devices).toBeNull();
      expect(r.counters).toBeNull();
      expect(r.services).toBeNull();

      // Verify error labels
      const labels = r.errors.map((e) => e.split(':')[0]);
      expect(labels).toContain('devices');
      expect(labels).toContain('counters');
      expect(labels).toContain('services');
    });

    await h.run(() => {
      throw new Error('Connection refused');
    });
  });

  it('counter extraction finds the right values', async () => {
    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      expect(r.counters).not.toBeNull();
      expect(r.counters!.callsActive).toBe(42);
      expect(r.counters!.registeredHardwarePhones).toBe(150);
      expect(r.counters!.registeredOtherStationDevices).toBe(25);

      // Raw should contain all 4 counters
      expect(r.counters!.raw).toHaveLength(4);
      const rawNames = r.counters!.raw.map((c) => c.name);
      expect(rawNames.some((n) => n.includes('CallsActive'))).toBe(true);
      expect(rawNames.some((n) => n.includes('RegisteredHardwarePhones'))).toBe(true);
      expect(rawNames.some((n) => n.includes('RegisteredOtherStationDevices'))).toBe(true);
      expect(rawNames.some((n) => n.includes('CallsCompleted'))).toBe(true);
    });

    await h.run(mockFetchRouter());
  });

  it('device count aggregation works', async () => {
    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      expect(r.devices).not.toBeNull();
      // 2 registered on pub, 1 unregistered on sub
      expect(r.devices!.registered).toBe(2);
      expect(r.devices!.unregistered).toBe(1);
      expect(r.devices!.totalFound).toBe(3);

      // byNode aggregation
      expect(r.devices!.byNode).toEqual([
        { name: 'cucm15-pub', devicesFound: 2 },
        { name: 'cucm15-sub', devicesFound: 1 },
      ]);
    });

    await h.run(mockFetchRouter());
  });

  it('missing counter returns 0 for that field', async () => {
    // PerfMon returns only CallsActive — the other two should default to 0
    const sparseCounterXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:perfmonCollectCounterDataResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ArrayOfCounterInfo>
        <item>
          <Name>\\\\10.0.0.1\\Cisco CallManager\\CallsActive</Name>
          <Value>7</Value>
          <CStatus>0</CStatus>
        </item>
      </ArrayOfCounterInfo>
    </ns:perfmonCollectCounterDataResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await clusterHealthCheck('10.0.0.1');

      expect(r.counters).not.toBeNull();
      expect(r.counters!.callsActive).toBe(7);
      expect(r.counters!.registeredHardwarePhones).toBe(0);
      expect(r.counters!.registeredOtherStationDevices).toBe(0);
      expect(r.counters!.raw).toHaveLength(1);
    });

    await h.run(
      mockFetchRouter({
        perfmonHandler: () =>
          responseBytes(Buffer.from(sparseCounterXml, 'utf8'), {
            headers: { 'content-type': 'text/xml' },
          }),
      }),
    );
  });
});
