import { withMockFetch, responseBytes } from './helpers.js';
import { applyPhone, updatePhonePacketCapture } from '../src/axl.js';

describe('axl', () => {
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

  it('updatePhonePacketCapture parses return', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:updatePhoneResponse xmlns:ns="http://www.cisco.com/AXL/API/15.0">
      <return>{ABC-123}</return>
    </ns:updatePhoneResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await updatePhonePacketCapture('192.168.125.10', {
        deviceName: 'SEP505C885DF37F',
        mode: 'Batch Processing Mode',
        durationSeconds: 60,
      });
      expect(r.returnValue).toBe('{ABC-123}');
    });

    await h.run(async (url, init) => {
      expect(url).toContain('/axl/');
      const soapAction =
        (init.headers as Record<string, string>)?.SOAPAction ??
        (init.headers as Record<string, string>)?.soapaction;
      expect(String(soapAction)).toContain('updatePhone');
      return responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      });
    });
  });

  it('applyPhone parses return', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:applyPhoneResponse xmlns:ns="http://www.cisco.com/AXL/API/15.0">
      <return>abc</return>
    </ns:applyPhoneResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      const r = await applyPhone('192.168.125.10', {
        deviceName: 'SEP505C885DF37F',
      });
      expect(r.returnValue).toBe('abc');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('SOAP fault throws', async () => {
    const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>nope</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(
        updatePhonePacketCapture('192.168.125.10', {
          deviceName: 'SEP505C885DF37F',
          mode: 'Batch Processing Mode',
          durationSeconds: 60,
        })
      ).rejects.toThrow(/fault/i);
    });

    await h.run(async () =>
      responseBytes(Buffer.from(xml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });
});
