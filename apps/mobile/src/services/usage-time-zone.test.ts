import { requestLocalUsage, usageTimeZone } from './usage-time-zone';

afterEach(() => jest.restoreAllMocks());

it.each([-540, -345, 210])('preserves the phone offset including fractional hours (%s)', (offset) => {
  jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(offset);
  expect(usageTimeZone().utcOffset).toBe(offset === -540 ? 'UTC+9:00' : offset === -345 ? 'UTC+5:45' : 'UTC-3:30');
});

it('sends the IANA zone so multi-day ranges can cross daylight-saving boundaries', async () => {
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/New_York' } as Intl.ResolvedDateTimeFormatOptions);
  const request = jest.fn(async (_query: object) => ({}));
  const input = { agentId: 'main', startDate: '2026-03-01', endDate: '2026-03-15' };
  await requestLocalUsage(request, input);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ ...input, mode: 'specific', timeZone: 'America/New_York' }));
});

it('only drops an explicitly rejected IANA field, retaining owner, dates and offset', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error("invalid params: unexpected property 'timeZone'")).mockResolvedValueOnce({ ok: true });
  const input = { agentId: 'lucy', startDate: '2026-09-21', endDate: '2026-09-21' };
  await expect(requestLocalUsage(request, input)).resolves.toEqual({ ok: true });
  expect(request).toHaveBeenLastCalledWith({ ...input, mode: 'specific', utcOffset: usageTimeZone().utcOffset });
});

it.each(['network disconnected', 'forbidden', "invalid params: unexpected property 'agentId'"])('never broadens scope on %s', async (message) => {
  const request = jest.fn().mockRejectedValue(new Error(message));
  await expect(requestLocalUsage(request, { agentId: 'lucy' })).rejects.toThrow(message);
  expect(request).toHaveBeenCalledTimes(1);
});

it('supports runtimes without IANA zone data', () => {
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('unsupported'); });
  expect(usageTimeZone()).toEqual({ mode: 'specific', utcOffset: expect.any(String) });
});
