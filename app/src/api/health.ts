const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

export async function fetchHealth(): Promise<void> {
  const res = await fetch(`${PROXY_URL}/healthz`);
  if (!res.ok) {
    throw new Error(`health check failed: ${res.status}`);
  }
}
