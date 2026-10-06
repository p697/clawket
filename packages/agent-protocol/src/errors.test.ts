import { expect, it } from 'vitest';
import { AdapterError, LocalSendRejectedError } from './index';

it('marks a locally refused frame as never sent', () => {
  const error = new LocalSendRejectedError();
  expect(error).toBeInstanceOf(AdapterError);
  expect(error).toMatchObject({ name: 'LocalSendRejectedError', code: 'frame_too_large', dispatchOutcome: 'not_sent' });
  expect(new AdapterError('server', 'refused', 'confirm_permissions').recoveryAction).toBe('confirm_permissions');
});
