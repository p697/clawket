import { describe, expect, it } from 'vitest';
import {
  AdapterError,
  CAPABILITY_KEYS,
  CAPABILITY_MATRIX,
  isImageAttachmentMimeType,
  normalizeAttachmentMimeType,
  resolveCapabilities,
  supportsAttachmentMimeType,
  supportsFileAttachments,
  supportsPromptAttachment,
  type Capability,
} from './index';

function enabled(backend: keyof typeof CAPABILITY_MATRIX): Capability[] {
  return CAPABILITY_KEYS.filter((key) => CAPABILITY_MATRIX[backend][key]);
}

describe('canonical capability contract', () => {
  it('publishes the frozen product matrix without conflating Hermes with legacy UI flags', () => {
    expect(enabled('openclaw')).toEqual(CAPABILITY_KEYS);
    expect(enabled('local-model')).toEqual(['chat', 'abort', 'history', 'attachments', 'models']);
    expect(enabled('hermes')).toEqual([
      'chat',
      'abort',
      'history',
      'attachments',
      'sessions',
      'sessionCreate',
      'sessionRename',
      'sessionReset',
      'sessionDelete',
      'agents',
      'models',
      'thinkingLevels',
      'skills',
      'skillDiscover',
      'skillInstall',
      'cron',
      'cronCreate',
      'files',
      'fileEdit',
      'usage',
      'cost',
    ]);
    expect(enabled('youmind')).toEqual(['chat', 'abort', 'history']);
  });

  it('allows runtime evidence to downgrade, never upgrade, backend capability policy', () => {
    expect(resolveCapabilities('openclaw').chat).toBe(true);
    expect(resolveCapabilities('openclaw', { chat: false, logs: false })).toMatchObject({
      chat: false,
      logs: false,
    });
    expect(resolveCapabilities('youmind', { chat: true, files: true })).toMatchObject({
      chat: true,
      files: false,
    });
    expect(resolveCapabilities('hermes', { fileAttachments: true }).fileAttachments).toBe(false);
    expect(resolveCapabilities('openclaw', { cronTimeZone: false, cronAdvanced: false })).toMatchObject({ cronTimeZone: false, cronAdvanced: false });
    expect(resolveCapabilities('hermes', { cronTimeZone: true, cronAdvanced: true }).cronTimeZone).toBeFalsy();
    expect(resolveCapabilities('hermes', { cronTimeZone: true, cronAdvanced: true }).cronAdvanced).toBeFalsy();
    expect(resolveCapabilities('openclaw').cronModel).toBe(true);
    expect(resolveCapabilities('openclaw', { cronModel: false }).cronModel).toBe(false);
    expect(resolveCapabilities('hermes', { cronModel: true }).cronModel).toBeFalsy();
    expect(resolveCapabilities('local-model', { cronModel: true }).cronModel).toBeFalsy();
    expect(resolveCapabilities('openclaw').modelManage).toBe(true);
    expect(resolveCapabilities('openclaw', { modelManage: false }).modelManage).toBe(false);
    expect(resolveCapabilities('hermes', { modelManage: true }).modelManage).toBe(false);
    expect(resolveCapabilities('local-model', { modelManage: true }).modelManage).toBeFalsy();
    expect(resolveCapabilities('openclaw').channelManage).toBe(true);
    expect(resolveCapabilities('openclaw', { channelManage: false }).channelManage).toBe(false);
    expect(resolveCapabilities('hermes', { channelManage: true }).channelManage).toBe(false);
    expect(resolveCapabilities('youmind', { channelManage: true }).channelManage).toBe(false);
  });

  it('expresses image-only Hermes attachment support without weakening other backends', () => {
    expect(normalizeAttachmentMimeType(' Image/PNG ')).toBe('image/png');
    expect(normalizeAttachmentMimeType(undefined)).toBe('application/octet-stream');
    expect(normalizeAttachmentMimeType('   ', ' Image/JPEG ')).toBe('image/jpeg');
    expect(isImageAttachmentMimeType(' Image/PNG ')).toBe(true);
    expect(supportsAttachmentMimeType(CAPABILITY_MATRIX.hermes, ' Image/PNG ')).toBe(true);
    expect(supportsAttachmentMimeType(CAPABILITY_MATRIX.hermes, 'application/pdf')).toBe(false);
    expect(supportsFileAttachments(CAPABILITY_MATRIX.hermes)).toBe(false);
    expect(supportsFileAttachments({ attachments: true })).toBe(false);
    expect(supportsFileAttachments(undefined)).toBe(false);
    expect(supportsAttachmentMimeType(CAPABILITY_MATRIX.openclaw, 'application/pdf')).toBe(true);
    expect(supportsFileAttachments(CAPABILITY_MATRIX.openclaw)).toBe(true);
    expect(supportsAttachmentMimeType(CAPABILITY_MATRIX.youmind, 'image/png')).toBe(false);
    expect(supportsPromptAttachment(CAPABILITY_MATRIX.hermes, {
      type: 'image',
      mimeType: ' Image/PNG ',
    })).toBe(true);
    expect(supportsPromptAttachment(CAPABILITY_MATRIX.hermes, {
      type: 'image',
      mimeType: 'application/pdf',
    })).toBe(false);
    expect(supportsPromptAttachment(CAPABILITY_MATRIX.openclaw, {
      type: 'file',
      mimeType: 'application/pdf',
    })).toBe(true);
  });

  it('provides a typed adapter error with a stable code', () => {
    const error = new AdapterError('bridge_offline', 'Bridge unavailable');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'AdapterError',
      code: 'bridge_offline',
      message: 'Bridge unavailable',
    });
  });
});
