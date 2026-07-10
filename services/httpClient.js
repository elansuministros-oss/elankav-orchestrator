const DEFAULT_TIMEOUT = 8000;

function nowMilliseconds() {
  return Number(process.hrtime.bigint() / 1000000n);
}

async function get(url, options = {}) {

  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  const started = nowMilliseconds();

  try {

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ELANKAV-Orchestrator/1.0',
        ...(options.headers || {})
      }
    });

    return {
      ok: response.ok,
      status: response.status,
      response,
      elapsed: nowMilliseconds() - started
    };

  } catch (error) {

    return {
      ok: false,
      status: null,
      error,
      elapsed: nowMilliseconds() - started
    };

  } finally {

    clearTimeout(timeout);

  }

}

module.exports = {
  get
};
