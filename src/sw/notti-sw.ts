import { realSleep } from '../retry';
import { idbStore } from '../store';
import { installWorker, type WorkerScope } from './worker';

const scope = self as unknown as WorkerScope;

installWorker(scope, {
  fetch: (input, init) => fetch(input, init),
  store: idbStore(),
  sleep: realSleep,
});
