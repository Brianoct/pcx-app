import { useEffect, useState } from 'react';

const hasWindow = typeof window !== 'undefined';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    if (!hasWindow || typeof navigator === 'undefined') return true;
    return Boolean(navigator.onLine);
  });

  useEffect(() => {
    if (!hasWindow) return undefined;
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
