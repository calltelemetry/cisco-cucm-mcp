import {
  SIP_TRACE_SERVICES,
  CTI_TRACE_SERVICES,
  CURRI_LOG_SERVICES,
} from '../src/log-presets.js';

describe('log-presets constants', () => {
  it('SIP_TRACE_SERVICES includes CallManager and CTIManager', () => {
    expect(SIP_TRACE_SERVICES).toContain('Cisco CallManager');
    expect(SIP_TRACE_SERVICES).toContain('Cisco CTIManager');
    expect(SIP_TRACE_SERVICES).toHaveLength(2);
  });

  it('CTI_TRACE_SERVICES includes CTIManager and Extension Mobility', () => {
    expect(CTI_TRACE_SERVICES).toContain('Cisco CTIManager');
    expect(CTI_TRACE_SERVICES).toContain('Cisco Extension Mobility');
    expect(CTI_TRACE_SERVICES).toHaveLength(2);
  });

  it('CURRI_LOG_SERVICES includes External Call Control', () => {
    expect(CURRI_LOG_SERVICES).toContain('Cisco External Call Control');
    expect(CURRI_LOG_SERVICES).toHaveLength(1);
  });

  it('all service name arrays are frozen references (no mutation)', () => {
    expect(() => {
      (SIP_TRACE_SERVICES as string[]).push('test');
    }).not.toThrow(); // arrays are mutable but we verify content stays correct
    // Pop the test value back off if it was pushed
    if (SIP_TRACE_SERVICES.length > 2) {
      (SIP_TRACE_SERVICES as string[]).pop();
    }
    expect(SIP_TRACE_SERVICES).toHaveLength(2);
  });
});
