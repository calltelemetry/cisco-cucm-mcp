import { extractBoundary, parseMultipartRelated } from '../src/multipart.js';
import { buildMultipartRelated } from './helpers.js';

describe('multipart', () => {
  it('extractBoundary handles quoted and unquoted', () => {
    expect(
      extractBoundary('multipart/related; type="text/xml"; boundary="----=_Part_1"')
    ).toBe('----=_Part_1');

    expect(
      extractBoundary('multipart/related; boundary=MIMEBoundaryurn_uuid_ABC')
    ).toBe('MIMEBoundaryurn_uuid_ABC');
  });

  it('parseMultipartRelated yields parts', () => {
    const boundary = 'MIMEBoundaryurn_uuid_X';
    const body = buildMultipartRelated(boundary, [
      {
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          'Content-Transfer-Encoding': 'binary',
        },
        body: Buffer.from('<a>ok</a>', 'utf8'),
      },
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Transfer-Encoding': 'binary',
        },
        body: Buffer.from([1, 2, 3, 4]),
      },
    ]);

    const parts = parseMultipartRelated(body, boundary);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.contentType).toBe('text/xml');
    expect(parts[1]?.contentType).toBe('application/octet-stream');
    expect([...(parts[1]?.body ?? [])]).toEqual([1, 2, 3, 4]);
  });
});
