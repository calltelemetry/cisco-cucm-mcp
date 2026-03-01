import { withMockFetch, responseBytes } from './helpers.js';
import { formatCdrTime, cdrGetFileList, cdrGetFileListMinutes } from '../src/cdr-on-demand.js';

describe('cdr-on-demand', () => {
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

  describe('formatCdrTime', () => {
    it('produces correct 12-digit UTC string', () => {
      // 2026-02-28 01:30 UTC
      const d = new Date(Date.UTC(2026, 1, 28, 1, 30));
      expect(formatCdrTime(d)).toBe('202602280130');
    });

    it('zero-pads month, day, hour, and minute', () => {
      // 2026-01-05 03:07 UTC
      const d = new Date(Date.UTC(2026, 0, 5, 3, 7));
      expect(formatCdrTime(d)).toBe('202601050307');
    });

    it('handles midnight correctly', () => {
      const d = new Date(Date.UTC(2026, 11, 31, 0, 0));
      expect(formatCdrTime(d)).toBe('202612310000');
    });

    it('handles end of day correctly', () => {
      const d = new Date(Date.UTC(2026, 5, 15, 23, 59));
      expect(formatCdrTime(d)).toBe('202606152359');
    });
  });

  describe('cdrGetFileList', () => {
    it('parses file list response', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:get_file_listResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <item>
        <FileName>cdr_StandAloneCluster_01_202602280100.txt</FileName>
        <FileSize>12345</FileSize>
        <Timestamp>202602280105</Timestamp>
      </item>
      <item>
        <FileName>cmr_StandAloneCluster_01_202602280100.txt</FileName>
        <FileSize>6789</FileSize>
        <Timestamp>202602280105</Timestamp>
      </item>
    </ns:get_file_listResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        const r = await cdrGetFileList('10.0.0.1', '202602280100', '202602280200');
        expect(r).toHaveLength(2);
        expect(r[0]!.fileName).toBe('cdr_StandAloneCluster_01_202602280100.txt');
        expect(r[0]!.fileSize).toBe(12345);
        expect(r[0]!.timestamp).toBe('202602280105');
        expect(r[1]!.fileName).toBe('cmr_StandAloneCluster_01_202602280100.txt');
        expect(r[1]!.fileSize).toBe(6789);
      });

      await h.run(async (url) => {
        expect(url).toContain('/CDRonDemandService2/');
        return responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        });
      });
    });

    it('empty result returns empty array', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:get_file_listResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
    </ns:get_file_listResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        const r = await cdrGetFileList('10.0.0.1', '202602280100', '202602280200');
        expect(r).toEqual([]);
      });

      await h.run(async () =>
        responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        })
      );
    });

    it('completely empty response body returns empty array', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        const r = await cdrGetFileList('10.0.0.1', '202602280100', '202602280200');
        expect(r).toEqual([]);
      });

      await h.run(async () =>
        responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        })
      );
    });

    it('time range exceeding 60 minutes throws', async () => {
      await expect(
        cdrGetFileList('10.0.0.1', '202602280100', '202602280300')
      ).rejects.toThrow(/exceeds 60 minutes/);
    });

    it('fromTime after toTime throws', async () => {
      await expect(
        cdrGetFileList('10.0.0.1', '202602280200', '202602280100')
      ).rejects.toThrow(/fromTime must be before toTime/);
    });

    it('invalid time format throws', async () => {
      await expect(
        cdrGetFileList('10.0.0.1', '20260228', '202602280200')
      ).rejects.toThrow(/Invalid CDR time format/);
    });

    it('SOAP fault throws', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>CDRonDemandService error: invalid time range</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        await expect(
          cdrGetFileList('10.0.0.1', '202602280100', '202602280200')
        ).rejects.toThrow(/fault/i);
      });

      await h.run(async () =>
        responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        })
      );
    });

    // Regression: HTTP 500 with SOAP fault should extract faultstring, not dump raw XML
    it('HTTP 500 SOAP fault extracts readable message', async () => {
      const xml = `<?xml version='1.0' encoding='UTF-8'?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>No file found within the specified time range</faultstring><detail /></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        await expect(
          cdrGetFileList('10.0.0.1', '202602280100', '202602280200')
        ).rejects.toThrow('No file found within the specified time range');
      });

      await h.run(async () =>
        responseBytes(Buffer.from(xml, 'utf8'), {
          status: 500,
          headers: { 'content-type': 'text/xml' },
        })
      );
    });

    it('parses single-item response (not wrapped in array)', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:get_file_listResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
      <item>
        <FileName>cdr_StandAloneCluster_01_202602280100.txt</FileName>
        <FileSize>5555</FileSize>
        <Timestamp>202602280105</Timestamp>
      </item>
    </ns:get_file_listResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        const r = await cdrGetFileList('10.0.0.1', '202602280100', '202602280200');
        expect(r).toHaveLength(1);
        expect(r[0]!.fileName).toBe('cdr_StandAloneCluster_01_202602280100.txt');
        expect(r[0]!.fileSize).toBe(5555);
      });

      await h.run(async () =>
        responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        })
      );
    });
  });

  describe('cdrGetFileListMinutes', () => {
    it('minutesBack exceeding 60 throws', async () => {
      await expect(
        cdrGetFileListMinutes('10.0.0.1', 90)
      ).rejects.toThrow(/exceeds 60 minutes/);
    });

    it('minutesBack zero or negative throws', async () => {
      await expect(
        cdrGetFileListMinutes('10.0.0.1', 0)
      ).rejects.toThrow(/must be positive/);
    });

    it('valid minutesBack calls CDRonDemandService', async () => {
      const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:get_file_listResponse xmlns:ns="http://schemas.cisco.com/ast/soap">
    </ns:get_file_listResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      const h = withMockFetch(async () => {
        const r = await cdrGetFileListMinutes('10.0.0.1', 30);
        expect(r).toEqual([]);
      });

      await h.run(async (url) => {
        expect(url).toContain('/CDRonDemandService2/');
        return responseBytes(Buffer.from(xml, 'utf8'), {
          headers: { 'content-type': 'text/xml' },
        });
      });
    });
  });
});
