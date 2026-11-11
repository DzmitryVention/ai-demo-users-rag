import { describe, expect, it } from 'vitest';
import { fullName, timeAgo } from './format.ts';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  it('formats recent and older dates', () => {
    expect(timeAgo('2026-11-11T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-11-11T10:00:00Z', now)).toMatch(/2 hours ago/);
    expect(timeAgo('2026-11-10T12:00:00Z', now)).toMatch(/yesterday|1 day ago/);
  });
});

describe('fullName', () => {
  it('joins and trims', () => {
    expect(fullName({ firstName: 'Bob', lastName: '' })).toBe('Bob');
  });
});
