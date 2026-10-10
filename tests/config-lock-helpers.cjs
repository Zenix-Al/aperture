const managers = new WeakMap();
function locksFor(storage) {
  if (managers.has(storage)) return managers.get(storage);
  const queues = new Map();
  const manager = { request(name, options, callback) {
    if (options.mode !== 'exclusive') throw new Error('fixture requires exclusive locks');
    const next = (queues.get(name) || Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }));
    queues.set(name, next.catch(() => {}));
    return next;
  } };
  managers.set(storage, manager);
  return manager;
}
module.exports = { locksFor };
