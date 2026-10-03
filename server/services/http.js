export class UpstreamError extends Error {
  constructor(source, message, status) {
    super(`${source}: ${message}`);
    this.source = source;
    this.status = status;
  }
}

/** GET JSON, retrying once on network errors, 429 and 5xx. */
export async function fetchJson(source, url, opts = {}) {
  try {
    return await fetchOnce(source, url, opts);
  } catch (err) {
    const retryable = !err.status || err.status === 429 || err.status >= 500;
    if (!retryable || opts.retry === false) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    return fetchOnce(source, url, opts);
  }
}

async function fetchOnce(source, url, { timeoutMs = 30000, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'solar-calculator/1.0', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new UpstreamError(source, err.name === 'TimeoutError' ? 'request timed out' : err.message);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body?.message || body?.errors?.join('; ') || body?.error?.message || text.slice(0, 200) || res.statusText;
    throw new UpstreamError(source, msg, res.status);
  }
  if (body === null) throw new UpstreamError(source, 'invalid JSON response');
  return body;
}
