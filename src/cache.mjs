/** Small caches for the slow Windows questions the page shows. */

export const memo = (ttl, fn, now = Date.now) => {
  let at = -Infinity
  let value
  let running = null
  return async () => {
    if (now() - at < ttl) return value
    // Two callers at the same time share ONE run (each run can start a slow Windows program).
    running ??= fn()
      .then((v) => {
        value = v
        at = now()
        return v
      })
      .finally(() => {
        running = null
      })
    return running
  }
}

/**
 * Like memo, for the slow Windows questions the page shows: (1) callers at the same time share one run; (2) once there is an answer, an
 * old one is returned AT ONCE while a new one loads in the background, so the page never waits for Windows twice; (3) `fresh()` forces a
 * new run and waits for it; `set()` stores an answer we already know; `stale()` makes the next call reload. A failed run keeps the old answer.
 */
export const swr = (ttl, load, now = Date.now) => {
  let at = -Infinity
  let value
  let has = false
  let running = null
  const start = () => {
    running ??= Promise.resolve()
      .then(load)
      .then(
        (v) => {
          value = v
          has = true
          at = now()
          return v
        },
        () => value,
      )
      .finally(() => {
        running = null
      })
    return running
  }
  const get = () => {
    if (has && now() - at < ttl) return Promise.resolve(value)
    const p = start()
    return has ? Promise.resolve(value) : p
  }
  get.fresh = start
  get.set = (v) => {
    value = v
    has = true
    at = now()
  }
  get.stale = () => {
    at = -Infinity
  }
  return get
}

