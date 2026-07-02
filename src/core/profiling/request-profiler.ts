import { AsyncLocalStorage } from "node:async_hooks";

type SlowQuery = {
  durationMs: number;
  query: string;
};

type RequestProfileStore = {
  requestId: string;
  queryCount: number;
  totalDbDurationMs: number;
  slowQueries: SlowQuery[];
};

const slowQueryThresholdMs = 150;
const maxSlowQueriesPerRequest = 5;
const requestProfileStore = new AsyncLocalStorage<RequestProfileStore>();

const normalizeSql = (query: string) =>
  query
    .replace(/\s+/g, " ")
    .replace(/\$\d+/g, "?")
    .trim();

export const isApiProfilingEnabled = () =>
  process.env.ENABLE_API_PROFILING === "true";

export const runWithRequestProfile = <T>(
  requestId: string,
  callback: () => T,
) => {
  if (!isApiProfilingEnabled()) {
    return callback();
  }

  return requestProfileStore.run(
    {
      requestId,
      queryCount: 0,
      totalDbDurationMs: 0,
      slowQueries: [],
    },
    callback,
  );
};

export const recordPrismaQuery = (query: string, durationMs: number) => {
  if (!isApiProfilingEnabled()) return;

  const store = requestProfileStore.getStore();
  if (!store) return;

  store.queryCount += 1;
  store.totalDbDurationMs += durationMs;

  if (durationMs < slowQueryThresholdMs) {
    return;
  }

  const slow: SlowQuery = {
    durationMs,
    query: normalizeSql(query),
  };

  if (store.slowQueries.length < maxSlowQueriesPerRequest) {
    store.slowQueries.push(slow);
  } else {
    const minIndex = store.slowQueries.reduce(
      (best, item, index, list) =>
        item.durationMs < list[best].durationMs ? index : best,
      0,
    );

    if (slow.durationMs > store.slowQueries[minIndex].durationMs) {
      store.slowQueries[minIndex] = slow;
    }
  }
};

export const getRequestProfileSnapshot = () => {
  const store = requestProfileStore.getStore();
  if (!store) return null;

  return {
    requestId: store.requestId,
    queryCount: store.queryCount,
    totalDbDurationMs: Math.round(store.totalDbDurationMs),
    slowQueries: [...store.slowQueries].sort(
      (a, b) => b.durationMs - a.durationMs,
    ),
  };
};
