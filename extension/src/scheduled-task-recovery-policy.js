export const RECOVERY_FALLBACK_MINUTES = Object.freeze({
  pageLoading: 2,
  active: 5,
  attention: 10,
  permissionHold: 15,
  idle: 30
});

const FAST_SESSION_STATES = new Set([
  'OPENING_FOLLOWUP',
  'ACTION_INTENT_PERSISTED',
  'WAITING_FOR_RUN_EVIDENCE',
  'ACTION_NOT_VERIFIED',
  'RUNNING_OBSERVED'
]);

const HOLD_SESSION_STATES = new Set([
  'SIGN_IN_REQUIRED',
  'BROWSER_VERIFICATION_REQUIRED',
  'SECURITY_APPROVAL_REQUIRED',
  'USER_DRAFT_PRESENT',
  'AMBIGUOUS_UI'
]);

export function recoveryFallbackMinutes(state = {}) {
  if (state?.config?.enabled === false) return 0;
  if (String(state?.status || '') === 'PAGE_LOADING') return RECOVERY_FALLBACK_MINUTES.pageLoading;
  const sessions = Object.values(state?.sessions || {});
  if (sessions.some((session) => FAST_SESSION_STATES.has(String(session?.status || '')))) return RECOVERY_FALLBACK_MINUTES.active;
  if (sessions.some((session) => HOLD_SESSION_STATES.has(String(session?.status || '')))) return RECOVERY_FALLBACK_MINUTES.permissionHold;
  if (Number(state?.counts?.attention || 0) > 0) return RECOVERY_FALLBACK_MINUTES.attention;
  return RECOVERY_FALLBACK_MINUTES.idle;
}

export function normalizedRecoverySignal(value) {
  return String(value || '').trim().slice(0, 240);
}
