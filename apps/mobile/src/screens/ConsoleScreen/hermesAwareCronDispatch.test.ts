import { resolveCronEditorDispatch } from './hermesAwareCronDispatch';

describe('resolveCronEditorDispatch', () => {
  const openclawCaps = { consoleCronCreate: true };
  const hermesCaps = { consoleCronCreate: false };

  describe('OpenClaw (consoleCronCreate: true)', () => {
    it('dispatches to backend when editing an existing job', () => {
      expect(resolveCronEditorDispatch({
        jobId: 'job_abc',
        capabilities: openclawCaps,
      })).toBe('backendDispatch');
    });

    it('dispatches to backend when creating a new job (create is allowed)', () => {
      expect(resolveCronEditorDispatch({
        jobId: null,
        capabilities: openclawCaps,
      })).toBe('backendDispatch');
    });

    it('dispatches to backend for undefined jobId (non-regression for OpenClaw create path)', () => {
      expect(resolveCronEditorDispatch({
        jobId: undefined,
        capabilities: openclawCaps,
      })).toBe('backendDispatch');
    });

    it('treats empty string jobId as create, still allows it for OpenClaw', () => {
      expect(resolveCronEditorDispatch({
        jobId: '',
        capabilities: openclawCaps,
      })).toBe('backendDispatch');
    });
  });

  describe('Hermes (consoleCronCreate: false)', () => {
    it('returns createUnavailable when no jobId is present', () => {
      expect(resolveCronEditorDispatch({
        jobId: null,
        capabilities: hermesCaps,
      })).toBe('createUnavailable');
    });

    it('returns createUnavailable for undefined jobId', () => {
      expect(resolveCronEditorDispatch({
        jobId: undefined,
        capabilities: hermesCaps,
      })).toBe('createUnavailable');
    });

    it('returns createUnavailable for empty string jobId', () => {
      expect(resolveCronEditorDispatch({
        jobId: '',
        capabilities: hermesCaps,
      })).toBe('createUnavailable');
    });

    it('dispatches to backend when editing an existing Hermes cron job', () => {
      expect(resolveCronEditorDispatch({
        jobId: 'hermes_job_123',
        capabilities: hermesCaps,
      })).toBe('backendDispatch');
    });
  });
});
