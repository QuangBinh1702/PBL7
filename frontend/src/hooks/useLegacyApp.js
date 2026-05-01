import { useEffect, useRef } from 'react';
import { startLegacyMapillaryApp } from '../legacy/legacyApp';

export function useLegacyApp(enabled = true) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    startedRef.current = true;
    startLegacyMapillaryApp();
  }, [enabled]);
}
