import { describe, expect, it } from 'vitest';
import { appointmentTime } from './appointmentTime';

describe('appointmentTime', () => {
  it('uses the activity start without an advance card', () => {
    expect(appointmentTime(2_000_000_000, false)).toBe(2_000_000_000);
  });

  it('schedules an advance card 30 minutes before the activity', () => {
    expect(appointmentTime(2_000_000_000, true)).toBe(1_999_998_200);
  });
});
