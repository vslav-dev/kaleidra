import { describe, expect, it } from 'vitest';
import { compareVersions } from '@/app/updates';

describe('compareVersions', () => {
  it('orders by major, minor, then patch, numerically', () => {
    expect(compareVersions('0.26.0', '0.25.9')).toBeGreaterThan(0);
    expect(compareVersions('0.25.10', '0.25.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.25.2', '0.25.2')).toBe(0);
    expect(compareVersions('0.25.1', '0.25.2')).toBeLessThan(0);
  });
});
