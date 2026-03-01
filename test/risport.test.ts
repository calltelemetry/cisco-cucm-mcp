import { withMockFetch, responseBytes } from './helpers.js';
import { selectCmDevice, selectCmDeviceAll, selectCmDeviceByIp, selectCtiItem } from '../src/risport.js';

describe('risport', () => {
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

  // Matches actual CUCM 15 response: selectCmDeviceReturn wrapper, nested IPAddress
  const multiNodeXml = `<?xml version="1.0"?>
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
                  <IPAddress>
                    <item><IP>10.0.1.100</IP><IPAddrType>ipv4</IPAddrType></item>
                  </IPAddress>
                  <Description>Lobby Phone</Description>
                  <DirNumber>1000-Registered</DirNumber>
                  <Status>Registered</Status>
                  <StatusReason>0</StatusReason>
                  <Protocol>SIP</Protocol>
                  <ActiveLoadID>sip78xx.14-3-1-0001-60</ActiveLoadID>
                  <TimeStamp>1704067200</TimeStamp>
                </item>
                <item>
                  <Name>SEP665544332211</Name>
                  <IPAddress>
                    <item><IP>10.0.1.101</IP><IPAddrType>ipv4</IPAddrType></item>
                  </IPAddress>
                  <Description>Conference Room</Description>
                  <DirNumber>1001-Registered</DirNumber>
                  <Status>Registered</Status>
                  <StatusReason>0</StatusReason>
                  <Protocol>SIP</Protocol>
                  <ActiveLoadID>sip88xx.14-3-1-0001-60</ActiveLoadID>
                  <TimeStamp>1704067200</TimeStamp>
                </item>
              </CmDevices>
            </item>
            <item>
              <ReturnCode>Ok</ReturnCode>
              <Name>cucm15-sub</Name>
              <CmDevices>
                <item>
                  <Name>SEPAABBCCDDEEFF</Name>
                  <IPAddress>
                    <item><IP>10.0.2.50</IP><IPAddrType>ipv4</IPAddrType></item>
                  </IPAddress>
                  <Description>Remote Office</Description>
                  <DirNumber>2000-Registered</DirNumber>
                  <Status>Registered</Status>
                  <StatusReason>0</StatusReason>
                  <Protocol>SIP</Protocol>
                  <ActiveLoadID>sip88xx.14-3-1-0001-60</ActiveLoadID>
                  <TimeStamp>1704067200</TimeStamp>
                </item>
              </CmDevices>
            </item>
          </CmNodes>
        </SelectCmDeviceResult>
      </ns:selectCmDeviceReturn>
    </ns:selectCmDeviceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('selectCmDevice parses multi-node response', async () => {
    const h = withMockFetch(async () => {
      const r = await selectCmDevice('10.0.0.1', { maxReturnedDevices: 1000 });
      expect(r.totalDevicesFound).toBe(3);
      expect(r.cmNodes).toHaveLength(2);
      expect(r.cmNodes[0]!.name).toBe('cucm15-pub');
      expect(r.cmNodes[0]!.devices).toHaveLength(2);
      expect(r.cmNodes[0]!.devices[0]!.name).toBe('SEP001122334455');
      expect(r.cmNodes[0]!.devices[0]!.ipAddress).toBe('10.0.1.100');
      expect(r.cmNodes[0]!.devices[0]!.protocol).toBe('SIP');
      expect(r.cmNodes[0]!.devices[0]!.dirNumber).toBe('1000-Registered');
      expect(r.cmNodes[0]!.devices[0]!.status).toBe('Registered');
      expect(r.cmNodes[1]!.name).toBe('cucm15-sub');
      expect(r.cmNodes[1]!.devices).toHaveLength(1);
      expect(r.cmNodes[1]!.devices[0]!.name).toBe('SEPAABBCCDDEEFF');
      expect(r.cmNodes[1]!.devices[0]!.ipAddress).toBe('10.0.2.50');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(multiNodeXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  const singleDeviceXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:selectCmDeviceResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ns:selectCmDeviceReturn>
        <SelectCmDeviceResult>
          <TotalDevicesFound>1</TotalDevicesFound>
          <CmNodes>
            <item>
              <ReturnCode>Ok</ReturnCode>
              <Name>cucm15-pub</Name>
              <CmDevices>
                <item>
                  <Name>SEP001122334455</Name>
                  <IPAddress>
                    <item><IP>10.0.1.100</IP><IPAddrType>ipv4</IPAddrType></item>
                  </IPAddress>
                  <Status>Registered</Status>
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

  it('selectCmDevice handles single node single device', async () => {
    const h = withMockFetch(async () => {
      const r = await selectCmDevice('10.0.0.1');
      expect(r.totalDevicesFound).toBe(1);
      expect(r.cmNodes).toHaveLength(1);
      expect(r.cmNodes[0]!.devices).toHaveLength(1);
      expect(r.cmNodes[0]!.devices[0]!.name).toBe('SEP001122334455');
      expect(r.cmNodes[0]!.devices[0]!.ipAddress).toBe('10.0.1.100');
      expect(r.cmNodes[0]!.devices[0]!.status).toBe('Registered');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(singleDeviceXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  // Also test backwards compat with older CUCM that returns flat IPAddress and no selectCmDeviceReturn wrapper
  const legacyXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:selectCmDeviceResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <SelectCmDeviceResult>
        <TotalDevicesFound>1</TotalDevicesFound>
        <CmNodes>
          <item>
            <ReturnCode>Ok</ReturnCode>
            <Name>10.0.0.1</Name>
            <CmDevices>
              <item>
                <Name>SEP001122334455</Name>
                <IpAddress>10.0.1.100</IpAddress>
                <Status>1</Status>
                <Protocol>SIP</Protocol>
              </item>
            </CmDevices>
          </item>
        </CmNodes>
      </SelectCmDeviceResult>
    </ns:selectCmDeviceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('selectCmDevice handles legacy response without selectCmDeviceReturn wrapper', async () => {
    const h = withMockFetch(async () => {
      const r = await selectCmDevice('10.0.0.1');
      expect(r.totalDevicesFound).toBe(1);
      expect(r.cmNodes).toHaveLength(1);
      expect(r.cmNodes[0]!.devices[0]!.name).toBe('SEP001122334455');
      expect(r.cmNodes[0]!.devices[0]!.ipAddress).toBe('10.0.1.100');
      expect(r.cmNodes[0]!.devices[0]!.status).toBe('1');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(legacyXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('selectCmDeviceByIp passes IPV4Address SelectBy', async () => {
    const h = withMockFetch(async () => {
      await selectCmDeviceByIp('10.0.0.1', '10.0.1.100');
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('IPV4Address');
      expect(body).toContain('10.0.1.100');
      return responseBytes(Buffer.from(singleDeviceXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('SOAP fault throws', async () => {
    const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>RIS query failed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(selectCmDevice('10.0.0.1')).rejects.toThrow(/fault/i);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(faultXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  // --------------------------------------------------------------------------
  // StateInfo pagination
  // --------------------------------------------------------------------------

  const page1Xml = `<?xml version="1.0"?>
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
                  <IPAddress><item><IP>10.0.1.100</IP></item></IPAddress>
                  <Status>Registered</Status>
                  <Protocol>SIP</Protocol>
                </item>
              </CmDevices>
            </item>
          </CmNodes>
        </SelectCmDeviceResult>
        <StateInfo>cursor-page2</StateInfo>
      </ns:selectCmDeviceReturn>
    </ns:selectCmDeviceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  const page2Xml = `<?xml version="1.0"?>
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
                  <Name>SEP665544332211</Name>
                  <IPAddress><item><IP>10.0.1.101</IP></item></IPAddress>
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
                  <IPAddress><item><IP>10.0.2.50</IP></item></IPAddress>
                  <Status>Registered</Status>
                  <Protocol>SIP</Protocol>
                </item>
              </CmDevices>
            </item>
          </CmNodes>
        </SelectCmDeviceResult>
        <StateInfo></StateInfo>
      </ns:selectCmDeviceReturn>
    </ns:selectCmDeviceResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  it('selectCmDevice extracts stateInfo from response', async () => {
    const h = withMockFetch(async () => {
      const r = await selectCmDevice('10.0.0.1', { maxReturnedDevices: 1000 });
      expect(r.stateInfo).toBe('cursor-page2');
      expect(r.totalDevicesFound).toBe(3);
      expect(r.cmNodes[0]!.devices).toHaveLength(1);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(page1Xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('selectCmDevice returns undefined stateInfo on last page', async () => {
    const h = withMockFetch(async () => {
      const r = await selectCmDevice('10.0.0.1');
      expect(r.stateInfo).toBeUndefined();
    });

    await h.run(async () =>
      responseBytes(Buffer.from(page2Xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('selectCmDevice passes stateInfo in SOAP envelope', async () => {
    const h = withMockFetch(async () => {
      await selectCmDevice('10.0.0.1', { stateInfo: 'my-cursor-123' });
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('<soap:StateInfo>my-cursor-123</soap:StateInfo>');
      return responseBytes(Buffer.from(page2Xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('selectCmDeviceAll auto-paginates and merges nodes', async () => {
    let callCount = 0;
    const h = withMockFetch(async () => {
      const r = await selectCmDeviceAll('10.0.0.1');
      expect(r.totalDevicesFound).toBe(3);
      // Nodes merged by name: cucm15-pub has 2 devices (1 from each page), cucm15-sub has 1
      expect(r.cmNodes).toHaveLength(2);
      const pub = r.cmNodes.find(n => n.name === 'cucm15-pub');
      const sub = r.cmNodes.find(n => n.name === 'cucm15-sub');
      expect(pub!.devices).toHaveLength(2);
      expect(pub!.devices[0]!.name).toBe('SEP001122334455');
      expect(pub!.devices[1]!.name).toBe('SEP665544332211');
      expect(sub!.devices).toHaveLength(1);
      expect(sub!.devices[0]!.name).toBe('SEPAABBCCDDEEFF');
    });

    await h.run(async (_url, init) => {
      callCount++;
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      if (callCount === 1) {
        // First call: should have empty StateInfo
        expect(body).toContain('<soap:StateInfo></soap:StateInfo>');
        return responseBytes(Buffer.from(page1Xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        });
      }
      // Second call: should pass the cursor from page 1
      expect(body).toContain('<soap:StateInfo>cursor-page2</soap:StateInfo>');
      return responseBytes(Buffer.from(page2Xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });

    expect(callCount).toBe(2);
  });

  // --------------------------------------------------------------------------
  // selectCtiItem
  // --------------------------------------------------------------------------

  it('selectCtiItem parses CTI provider response', async () => {
    // WSDL structure: CtiNodes → item[] (CtiNode) → CtiItems → item[] (CtiItem)
    const ctiXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:selectCtiItemResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <ns:selectCtiItemReturn>
        <SelectCtiItemResult>
          <TotalItemsFound>2</TotalItemsFound>
          <CtiNodes>
            <item>
              <Name>cucm15-pub</Name>
              <CtiItems>
                <item>
                  <Name>CTIPort1</Name>
                  <IPAddress>10.0.0.50</IPAddress>
                  <Status>Open</Status>
                  <AppID>CiscoJTAPI</AppID>
                  <UserID>jtapiuser</UserID>
                </item>
                <item>
                  <Name>CTIRoutePoint1</Name>
                  <IPAddress>10.0.0.51</IPAddress>
                  <Status>Open</Status>
                  <AppID>CiscoJTAPI</AppID>
                  <UserID>jtapiuser</UserID>
                </item>
              </CtiItems>
            </item>
          </CtiNodes>
        </SelectCtiItemResult>
      </ns:selectCtiItemReturn>
    </ns:selectCtiItemResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await selectCtiItem('10.0.0.1', { ctiMgrClass: 'Provider' });
      expect(r.totalItemsFound).toBe(2);
      expect(r.items).toHaveLength(2);
      expect(r.items[0]!.name).toBe('CTIPort1');
      expect(r.items[0]!.ipAddress).toBe('10.0.0.50');
      expect(r.items[0]!.status).toBe('Open');
      expect(r.items[0]!.appId).toBe('CiscoJTAPI');
      expect(r.items[0]!.userId).toBe('jtapiuser');
      expect(r.items[1]!.name).toBe('CTIRoutePoint1');
    });

    await h.run(async (_url, init) => {
      const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer).toString('utf8');
      expect(body).toContain('selectCtiItem');
      expect(body).toContain('Provider');
      expect(body).toContain('SelectAppBy');
      expect(body).not.toContain('AppID>');
      return responseBytes(Buffer.from(ctiXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });
});
