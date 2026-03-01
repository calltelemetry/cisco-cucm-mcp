import { withMockFetch, responseBytes } from './helpers.js';
import { fetchServiceabilitySoap } from '../src/soap.js';

describe('fetchServiceabilitySoap', () => {
  // Regression: HTTP 500 with SOAP fault body should extract faultstring, not dump raw XML
  it('HTTP 500 with SOAP fault extracts readable message', async () => {
    const faultXml = `<?xml version='1.0' encoding='UTF-8'?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>No file found within the specified time range</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(
        fetchServiceabilitySoap('10.0.0.1', 8443, { username: 'u', password: 'p' }, '/test', 'testAction', '<body/>')
      ).rejects.toThrow('No file found within the specified time range');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(faultXml, 'utf8'), {
        status: 500,
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('HTTP 500 with SOAP fault does NOT contain raw XML in error', async () => {
    const faultXml = `<?xml version='1.0' encoding='UTF-8'?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Service query failed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      try {
        await fetchServiceabilitySoap('10.0.0.1', 8443, { username: 'u', password: 'p' }, '/test', 'testAction', '<body/>');
        throw new Error('Should have thrown');
      } catch (e: unknown) {
        const msg = (e as Error).message;
        // Should NOT contain raw XML tags
        expect(msg).not.toContain('<soapenv:');
        expect(msg).not.toContain('<?xml');
        // Should contain the parsed fault string
        expect(msg).toContain('Service query failed');
        expect(msg).toContain('HTTP 500');
      }
    });

    await h.run(async () =>
      responseBytes(Buffer.from(faultXml, 'utf8'), {
        status: 500,
        headers: { 'content-type': 'text/xml' },
      })
    );
  });

  it('HTTP 500 with non-XML body falls back to raw text', async () => {
    const h = withMockFetch(async () => {
      await expect(
        fetchServiceabilitySoap('10.0.0.1', 8443, { username: 'u', password: 'p' }, '/test', 'testAction', '<body/>')
      ).rejects.toThrow('HTTP 500');
    });

    await h.run(async () =>
      responseBytes(Buffer.from('Internal Server Error', 'utf8'), {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      })
    );
  });

  it('HTTP 401 returns status in error', async () => {
    const h = withMockFetch(async () => {
      await expect(
        fetchServiceabilitySoap('10.0.0.1', 8443, { username: 'u', password: 'p' }, '/test', 'testAction', '<body/>')
      ).rejects.toThrow('HTTP 401');
    });

    await h.run(async () =>
      responseBytes(Buffer.from('Unauthorized', 'utf8'), {
        status: 401,
        headers: { 'content-type': 'text/html' },
      })
    );
  });

  it('HTTP 200 with SOAP fault still throws', async () => {
    const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Internal error</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

    const h = withMockFetch(async () => {
      await expect(
        fetchServiceabilitySoap('10.0.0.1', 8443, { username: 'u', password: 'p' }, '/test', 'testAction', '<body/>')
      ).rejects.toThrow('Internal error');
    });

    await h.run(async () =>
      responseBytes(Buffer.from(faultXml, 'utf8'), {
        headers: { 'content-type': 'text/xml' },
      })
    );
  });
});
