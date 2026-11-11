import { describe, expect, it } from 'vitest';
import { splitDisplayName } from './users.ts';

describe('splitDisplayName', () => {
  it('uses the last word as surname', () => {
    expect(splitDisplayName('Ann Marie Lee', 'a@x.io')).toEqual(['Ann Marie', 'Lee']);
  });
  it('handles single names and missing names', () => {
    expect(splitDisplayName('Cher', 'c@x.io')).toEqual(['Cher', '']);
    expect(splitDisplayName(null, 'john.doe@x.io')).toEqual(['john.doe', '']);
    expect(splitDisplayName('   ', 'j@x.io')).toEqual(['j', '']);
  });
});
