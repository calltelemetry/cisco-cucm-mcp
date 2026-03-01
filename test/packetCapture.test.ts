import {
  sanitizeFileBase,
  buildCaptureCommand,
  remoteCapturePath,
} from '../src/packetCapture.js';

describe('packetCapture', () => {
  it('sanitizeFileBase removes dots and unsafe chars', () => {
    expect(sanitizeFileBase('packets.cap')).toBe('packets_cap');
    expect(sanitizeFileBase('  my cap  ')).toBe('my_cap');
  });

  it('buildCaptureCommand includes filters', () => {
    const cmd = buildCaptureCommand({
      iface: 'eth0',
      fileBase: 'packets',
      count: 1000,
      size: 'all',
      hostFilterIp: '10.0.0.1',
      portFilter: 5060,
    });
    expect(cmd).toContain('utils network capture eth0');
    expect(cmd).toContain('file packets');
    expect(cmd).toContain('count 1000');
    expect(cmd).toContain('size all');
    expect(cmd).toContain('port 5060');
    expect(cmd).toContain('host ip 10.0.0.1');
  });

  it('remoteCapturePath uses platform/cli', () => {
    expect(remoteCapturePath('packets')).toBe('/var/log/active/platform/cli/packets.cap');
  });
});
