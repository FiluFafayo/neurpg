import * as Comlink from 'comlink';
// Import the worker type for TypeScript intellisense without importing the code
import type { LayoutWorker } from './layout.worker';

// Vite worker import syntax
import Worker from './layout.worker?worker';

let workerInstance: Comlink.Remote<LayoutWorker> | null = null;

export const getWorker = (): Comlink.Remote<LayoutWorker> => {
  if (!workerInstance) {
    const worker = new Worker();
    workerInstance = Comlink.wrap<LayoutWorker>(worker);
  }
  return workerInstance;
};
