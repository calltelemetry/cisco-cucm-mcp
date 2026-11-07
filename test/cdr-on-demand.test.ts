import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withMockFetch, responseBytes, buildMultipartRelated } from './helpers.js';
import { formatCdrTime, cdrGetFileList, cdrGetFileListMinutes, cdrDownloadFile } from '../src/cdr-on-demand.js';

describe('cdr-on-demand', () => {
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

  describe('cdrDownloadFile', () => {
    it.each([
      ['CDR with sequence number', 'cdr_StandAloneCluster_01_202602280100_0'],
      ['CMR with sequence number', 'cmr_StandAloneCluster_02_202602280100_6125'],
      ['CMR with a leading hyphen in its cluster ID', 'cmr_-edge.cluster_02_202602280100_6125'],
      ['CMR with repeated periods in its cluster ID', 'cmr_..edge.cluster_02_202602280100_6125'],
      ['CDR with text extension', 'cdr_StandAloneCluster_01_202602280100.txt'],
    ] as const)('downloads the listed %s file from its dated repository directory', async (_kind, fileName) => {
      const boundary = 'DIME-boundary-test';
      const fileBytes = Buffer.from([0x63, 0x64, 0x72, 0x00, 0xff, 0x0a]);
      const multipart = buildMultipartRelated(boundary, [
        {
          headers: { 'Content-Type': 'application/xop+xml; charset=UTF-8; type="text/xml"' },
          body: '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body/></soapenv:Envelope>',
        },
        {
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Transfer-Encoding': 'binary' },
          body: fileBytes,
        },
      ]);
      const directory = mkdtempSync(join(tmpdir(), 'cucm-cdr-download-'));
      const outFile = join(directory, 'download.bin');
      const expectedRemotePath = `/var/log/active/cm/cdr_repository/processed/20260228/${fileName}`;

      try {
        const h = withMockFetch(async () => {
          const result = await cdrDownloadFile('10.0.0.1', fileName, outFile);
          expect(result).toEqual({ filePath: outFile, bytes: fileBytes.length, server: '10.0.0.1' });
          expect(readFileSync(outFile)).toEqual(fileBytes);
        });

        await h.run(async (url, init) => {
          expect(url).toBe('https://10.0.0.1:8443/logcollectionservice/services/DimeGetFileService');
          expect(String(init.body)).toContain(`<FileName xsi:type="get:FileName" xmlns:get="http://cisco.com/ccm/serviceability/soap/LogCollection/GetFile/">${expectedRemotePath}</FileName>`);
          return responseBytes(multipart, {
            headers: { 'content-type': `multipart/related; boundary="${boundary}"; type="application/xop+xml"` },
          });
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it.each([
      '../cdr_StandAloneCluster_01_202602280100.txt',
      'cmr_StandAloneCluster_01_202602300100.txt',
      'cdr_StandAloneCluster_01_202602280100.txt\n',
    ])('rejects a non-basename or invalid-date CDR repository filename', async (fileName) => {
      const h = withMockFetch(async ({ calls }) => {
        await expect(cdrDownloadFile('10.0.0.1', fileName)).rejects.toThrow('Invalid CDR repository filename');
        expect(calls).toHaveLength(0);
      });

      await h.run(async () => responseBytes(Buffer.from('failure'), { status: 500 }));
    });
  });
});
