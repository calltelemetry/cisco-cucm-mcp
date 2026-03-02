import { TRACE_LEVELS, TRACE_LEVEL_MAP, TRACE_LEVEL_REVERSE } from '../src/trace-config.js';

describe('trace-config constants', () => {
  it('TRACE_LEVELS has 7 levels in order', () => {
    expect(TRACE_LEVELS).toHaveLength(7);
    expect(TRACE_LEVELS[0]).toBe('Error');
    expect(TRACE_LEVELS[6]).toBe('Detailed');
  });

  it('TRACE_LEVEL_MAP maps all levels to cumulative bitmask values', () => {
    expect(TRACE_LEVEL_MAP['Error']).toBe(1);
    expect(TRACE_LEVEL_MAP['Special']).toBe(3);
    expect(TRACE_LEVEL_MAP['State Transition']).toBe(7);
    expect(TRACE_LEVEL_MAP['Significant']).toBe(15);
    expect(TRACE_LEVEL_MAP['Entry/Exit']).toBe(31);
    expect(TRACE_LEVEL_MAP['Arbitrary']).toBe(63);
    expect(TRACE_LEVEL_MAP['Detailed']).toBe(127);
  });

  it('TRACE_LEVEL_REVERSE maps bitmask values back to level names', () => {
    expect(TRACE_LEVEL_REVERSE[1]).toBe('Error');
    expect(TRACE_LEVEL_REVERSE[15]).toBe('Significant');
    expect(TRACE_LEVEL_REVERSE[127]).toBe('Detailed');
  });

  it('MAP and REVERSE are consistent', () => {
    for (const level of TRACE_LEVELS) {
      const num = TRACE_LEVEL_MAP[level];
      expect(TRACE_LEVEL_REVERSE[num]).toBe(level);
    }
  });

  it('bitmask values are cumulative (each includes all lower bits)', () => {
    let prev = 0;
    for (const level of TRACE_LEVELS) {
      const val = TRACE_LEVEL_MAP[level];
      expect(val).toBeGreaterThan(prev);
      // Each level includes all bits of previous levels
      expect(val & prev).toBe(prev);
      prev = val;
    }
  });
});
