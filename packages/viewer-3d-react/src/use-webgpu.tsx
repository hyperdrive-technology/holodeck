import { useEffect, useState } from 'react';

export type WebGPUSupport = 'pending' | 'ready' | 'missing';

/** Client-only. `navigator.gpu` is absent during SSR. */
export function useWebGPUSupport(): WebGPUSupport {
  const [support, setSupport] = useState<WebGPUSupport>('pending');
  useEffect(() => {
    // TypeScript 5.9's DOM lib in this package does not declare Navigator.gpu.
    const gpu = (navigator as Navigator & { gpu?: object }).gpu;
    setSupport(gpu ? 'ready' : 'missing');
  }, []);
  return support;
}

export function WebGPUMissing() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 24,
        color: '#c5c8d4',
        font: '14px/1.4 Helvetica Neue, Helvetica, Arial, sans-serif',
        textAlign: 'center',
      }}
    >
      WebGPU is not available in this browser.
    </div>
  );
}
