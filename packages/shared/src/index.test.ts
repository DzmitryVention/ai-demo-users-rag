import { describe, expect, it } from 'vitest';
import {
  CreateTicketSchema,
  UpdateProfileSchema,
  isAdminEmail,
  nextStatusAfterMessage,
} from './index.ts';

describe('isAdminEmail', () => {
  const admins = ['admin@example.com'];

  it('matches case-insensitively and trims', () => {
    expect(isAdminEmail('  Admin@Example.COM ', admins)).toBe(true);
  });

  it('rejects other and empty emails', () => {
    expect(isAdminEmail('someone@example.com', admins)).toBe(false);
    expect(isAdminEmail(undefined, admins)).toBe(false);
    expect(isAdminEmail('', admins)).toBe(false);
  });
});

describe('nextStatusAfterMessage', () => {
  it('admin or bot reply → answered, user follow-up → open', () => {
    expect(nextStatusAfterMessage('admin')).toBe('answered');
    expect(nextStatusAfterMessage('bot')).toBe('answered');
    expect(nextStatusAfterMessage('user', 'answered')).toBe('open');
  });

  it('keeps a ticket waiting for a human when the user follows up', () => {
    expect(nextStatusAfterMessage('user', 'pending_human')).toBe('pending_human');
    expect(nextStatusAfterMessage('admin', 'pending_human')).toBe('answered');
  });
});

describe('UpdateProfileSchema', () => {
  it('normalizes empty optional fields to null', () => {
    const parsed = UpdateProfileSchema.parse({
      firstName: ' Ann ',
      lastName: 'Lee',
      phone: '',
      about: '  ',
    });
    expect(parsed).toEqual({ firstName: 'Ann', lastName: 'Lee', phone: null, about: null });
  });

  it('rejects invalid phone numbers', () => {
    const result = UpdateProfileSchema.safeParse({
      firstName: 'Ann',
      lastName: 'Lee',
      phone: 'call me',
      about: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateTicketSchema', () => {
  it('requires a subject of at least 3 chars and a body', () => {
    expect(CreateTicketSchema.safeParse({ subject: 'Hi', body: 'x' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: 'Help', body: ' ' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: 'Help me', body: 'Please' }).success).toBe(true);
  });
});
