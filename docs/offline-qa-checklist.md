# Offline/Online Resilience QA Checklist (Phase 3)

This checklist validates queue hardening, auth pause behavior, and recovery UX.

## Preconditions
- App loaded with a valid account and data.
- Browser DevTools available to simulate offline/online.
- Use a role that can access: Historial, Inventario, Admin, Perfil.

## 1) Queue while offline
1. Go offline in browser network controls.
2. Trigger writes in different modules:
   - Historial: edit quote, delete quote, change status.
   - Inventario: save stock and min stock.
   - Admin: create/edit/delete user or product.
3. Verify:
   - No hard failure blocks the flow.
   - Pending actions appear in the outbox panel.
   - Local optimistic UI updates are visible where expected.

## 2) Auto-sync when connection returns
1. Bring connection back online.
2. Verify:
   - Outbox pending items start syncing automatically.
   - Successful items are removed from queue.
   - No duplicate writes are created.

## 3) Auth expiry pause behavior
1. Invalidate session token (logout in another tab or force 401 from API).
2. Trigger queue processing (manual retry or wait for interval).
3. Verify:
   - Processing pauses on auth failure.
   - Banner appears indicating session must be renewed.
   - Outbox items remain intact (not lost).
4. Re-login and verify queue resumes.

## 4) Retry limits / backoff
1. Simulate repeated transient failures (5xx/timeout).
2. Verify:
   - Attempts increase with backoff.
   - Item eventually moves to manual error after max attempts.
   - Recommended action text appears for user.

## 5) Conflict recovery UX
1. Force a non-retryable conflict (409/404/422) on a queued item.
2. Verify:
   - Item shows clear guidance and error details.
   - "Abrir registro" navigates to expected panel.
   - "Reintentar actual" retries with latest payload behavior.
   - "Cancelar" removes only selected queued action.

## 6) Regression checks
- Login/logout still works.
- Main navigation and routing unchanged.
- Build succeeds (`npm run build`).
- No console spam from queue loop after idle.
