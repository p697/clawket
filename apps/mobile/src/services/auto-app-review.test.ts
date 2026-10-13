jest.mock('react-native', () => ({ AppState: { currentState: 'active' }, Linking: { openURL: jest.fn(), canOpenURL: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('expo-store-review', () => ({ isAvailableAsync: jest.fn(), requestReview: jest.fn(), storeUrl: jest.fn() }));
jest.mock('../config/public', () => ({ publicAppLinks: { iosAppStoreId: '123' } }));
jest.mock('./analytics/events', () => ({ analyticsEvents: { appReviewRequest: jest.fn() } }));
jest.mock('./storage', () => ({ StorageService: { getAutoAppReviewState: jest.fn(), setAutoAppReviewState: jest.fn() } }));
import { AppState, Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';
import { StorageService } from './storage';
import { analyticsEvents } from './analytics/events';
import { completedReviewTurn, emptyReviewState, type AutoAppReviewState } from './auto-app-review-state';
import { __resetAutomaticAppReviewRuntimeForTests, recordCompletedTurnForAutomaticReview, requestAutomaticAppReview, requestManualAppReview } from './auto-app-review';
const now = new Date(2026, 9, 13, 12).getTime();
let state: AutoAppReviewState | null;
const dev = __DEV__;
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); jest.setSystemTime(now);
  (globalThis as any).__DEV__ = false;
  (Platform as any).OS = 'ios'; (AppState as any).currentState = 'active';
  __resetAutomaticAppReviewRuntimeForTests();
  state = [now - 86_400_000, now, now].reduce(completedReviewTurn, emptyReviewState());
  jest.mocked(StorageService.getAutoAppReviewState).mockImplementation(async () => state);
  jest.mocked(StorageService.setAutoAppReviewState).mockImplementation(async value => { state = value; });
  jest.mocked(StoreReview.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(StoreReview.requestReview).mockResolvedValue(undefined);
  jest.mocked(Linking.openURL).mockResolvedValue(undefined);
});
afterEach(() => { (globalThis as any).__DEV__ = dev; jest.useRealTimers(); });
it('persists before calling native, never interprets resolution as a submitted rating, and is single flight', async () => {
  jest.mocked(StoreReview.requestReview).mockImplementation(async () => { expect(state?.attempts).toHaveLength(1); });
  await Promise.all([requestAutomaticAppReview(() => true), requestAutomaticAppReview(() => true)]);
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  expect(analyticsEvents.appReviewRequest).toHaveBeenCalledWith({ outcome: 'requested', reason: 'eligible' });
});
it('serializes concurrent completions without losing counts and contains storage failures', async () => {
  state = null;
  await Promise.all([recordCompletedTurnForAutomaticReview(), recordCompletedTurnForAutomaticReview()]);
  expect((state as AutoAppReviewState | null)?.completedTurns).toBe(2);
  jest.mocked(StorageService.setAutoAppReviewState).mockRejectedValue(new Error('disk'));
  await expect(recordCompletedTurnForAutomaticReview()).resolves.toBeUndefined();
});
it.each(['android', 'development', 'background', 'unsafe'])('does not request when %s', async mode => {
  if (mode === 'android') (Platform as any).OS = 'android';
  if (mode === 'development') (globalThis as any).__DEV__ = true;
  if (mode === 'background') (AppState as any).currentState = 'background';
  await requestAutomaticAppReview(() => mode !== 'unsafe');
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});
it('rechecks safety after native availability waits', async () => {
  let safe = true;
  jest.mocked(StoreReview.isAvailableAsync).mockImplementation(async () => { safe = false; return true; });
  await requestAutomaticAppReview(() => safe);
  expect(StorageService.setAutoAppReviewState).not.toHaveBeenCalled();
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});
it('rechecks safety after persistence, keeping the conservative attempt record', async () => {
  let safe = true;
  jest.mocked(StorageService.setAutoAppReviewState).mockImplementation(async value => { state = value; safe = false; });
  await requestAutomaticAppReview(() => safe);
  expect(state?.attempts).toHaveLength(1);
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});
it.each(['read', 'write'])('fails closed on %s failure', async stage => {
  jest.mocked(stage === 'read' ? StorageService.getAutoAppReviewState : StorageService.setAutoAppReviewState).mockRejectedValue(new Error('storage'));
  await requestAutomaticAppReview(() => true);
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});
it('unavailable native API does not spend the invitation', async () => {
  jest.mocked(StoreReview.isAvailableAsync).mockResolvedValue(false);
  await requestAutomaticAppReview(() => true);
  expect(state?.attempts).toHaveLength(0);
});
it('a native error consumes the attempt and cannot immediately retry', async () => {
  jest.mocked(StoreReview.requestReview).mockRejectedValue(new Error('native'));
  await requestAutomaticAppReview(() => true);
  __resetAutomaticAppReviewRuntimeForTests();
  await requestAutomaticAppReview(() => true);
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
});
it('manual iOS scoring opens the write-review page directly and suppresses automatic invitations', async () => {
  await expect(requestManualAppReview()).resolves.toBe('store_page');
  expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id123?action=write-review');
  expect(StoreReview.isAvailableAsync).not.toHaveBeenCalled();
  expect(state?.lastManualAtMs).toBe(now);
  await requestAutomaticAppReview(() => true);
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});
it('manual store link survives persistence failure and reports link failure honestly', async () => {
  jest.mocked(StorageService.setAutoAppReviewState).mockRejectedValue(new Error('disk'));
  await expect(requestManualAppReview()).resolves.toBe('store_page');
  jest.mocked(Linking.openURL).mockRejectedValue(new Error('link'));
  await expect(requestManualAppReview()).resolves.toBe('error');
});
it('preserves Android manual native behavior', async () => {
  (Platform as any).OS = 'android';
  await expect(requestManualAppReview()).resolves.toBe('review_prompt');
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
});
