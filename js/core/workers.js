// Small pool of terrain workers. Results are routed back by message key.
export class WorkerPool {
  constructor(count, biome, seed, sun) {
    this.workers = [];
    this.handlers = new Map();
    this.next = 0;
    this.pending = 0;
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('../world/terrainWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        this.pending--;
        const h = this.handlers.get(e.data.key);
        this.handlers.delete(e.data.key);
        if (h) h(e.data);
      };
      w.onerror = (e) => console.error('terrain worker error', e.message || e);
      w.postMessage({ type: 'init', biome, seed, sun: sun && { x: sun.x, y: sun.y, z: sun.z } });
      this.workers.push(w);
    }
  }
  request(msg, cb) {
    this.handlers.set(msg.key, cb);
    this.pending++;
    this.workers[this.next].postMessage(msg);
    this.next = (this.next + 1) % this.workers.length;
  }
  dispose() {
    this.workers.forEach((w) => w.terminate());
    this.handlers.clear();
  }
}
