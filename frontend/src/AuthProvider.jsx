import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './authContext';
import { buildAccessForUser } from './roleAccess';
import { apiRequest } from './apiClient';

const readJson = (key) => {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => readJson('user'));
  const [role, setRole] = useState(() => localStorage.getItem('role'));
  const [access, setAccess] = useState(() => readJson('panel_access'));

  const applyUser = useCallback((userData) => {
    if (!userData) return;
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('role', userData.role);
    localStorage.setItem('panel_access', JSON.stringify(userData.panel_access || null));
    setUser(userData);
    setRole(userData.role);
    setAccess(userData.panel_access || null);
  }, []);

  const login = useCallback((newToken, userData) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    applyUser(userData);
  }, [applyUser]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    localStorage.removeItem('panel_access');
    setToken(null);
    setUser(null);
    setRole(null);
    setAccess(null);
  }, []);

  // Refresh the cached session (role/permissions may change server-side).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest('/api/me', { token, timeoutMs: 10000 })
      .then((me) => {
        if (!cancelled) applyUser(me);
      })
      .catch((err) => {
        // A clearly rejected session (expired/invalid token) should clear the
        // stale login so the user is sent back to the login screen instead of
        // hitting "Token inválido" on every request. Network/offline errors
        // (no HTTP status) keep the cached session so offline use still works.
        if (!cancelled && (err?.status === 401 || err?.status === 403)) {
          logout();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, applyUser, logout]);

  const effectiveAccess = useMemo(() => buildAccessForUser(role, access), [role, access]);

  const displayName = useMemo(() => {
    if (!user) return 'Usuario';
    return String(user.display_name || '').trim() || String(user.email || '').split('@')[0] || 'Usuario';
  }, [user]);

  const value = useMemo(() => ({
    token,
    user,
    role,
    access,
    effectiveAccess,
    displayName,
    login,
    logout,
    updateUser: applyUser
  }), [token, user, role, access, effectiveAccess, displayName, login, logout, applyUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
