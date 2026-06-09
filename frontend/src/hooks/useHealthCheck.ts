import { useState, useEffect } from 'react';

export interface HealthResponse {
  ok: boolean;
  timestamp: string;
}

export interface HealthStatus {
  isOnline: boolean;
  lastChecked: string | null;
  isLoading: boolean;
}

export function useHealthCheck(pollIntervalMs: number = 30000): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>({
    isOnline: false,
    lastChecked: null,
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/health', {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!isMounted) return;

        if (response.ok) {
          const data: HealthResponse = await response.json();
          setStatus({
            isOnline: data.ok,
            lastChecked: data.timestamp,
            isLoading: false,
          });
        } else {
          setStatus({
            isOnline: false,
            lastChecked: new Date().toISOString(),
            isLoading: false,
          });
        }
      } catch (error) {
        if (!isMounted) return;
        setStatus({
          isOnline: false,
          lastChecked: new Date().toISOString(),
          isLoading: false,
        });
      }
    };

    checkHealth();

    const intervalId = setInterval(checkHealth, pollIntervalMs);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [pollIntervalMs]);

  return status;
}
