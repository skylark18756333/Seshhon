// Small browser-safe helpers shared by native request and state management.
export const REQUEST_TIMEOUT_MS = 15000;
export async function request(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        // Read the body inside the deadline, not after the headers-only fetch resolves.
        const text = await response.text();
        return new Response([204, 205, 304].includes(response.status) ? null : text, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error('The connection took too long. Try again.'), { network: true, code: 'timeout' });
          reject(error);
          controller.abort();
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof TypeError) throw Object.assign(new Error('Could not connect. Check your signal and try again.'), { network: true });
    throw error;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export function latestRead() {
  let version = 0;
  return {
    begin: () => ++version,
    invalidate: () => { version += 1; },
    current: (ticket: number) => ticket === version
  };
}
