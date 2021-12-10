
const wait = async (durationMs) => await (new Promise(
  (resolve) => setTimeout(resolve, durationMs),
));

/**
 * @example: Sleep down with increasing delays of naps
 *
 * await cpMap(
 *   [1, 2, 4, 8],
 *   (delaySec) => new Promise((resolve) => {
 *     setTimeout(resolve, delaySec * 1000);
 *   })
 * );
 *
 * console.warning('ANCHOR? Chto?! Skolko vremeni?');
 */

const DEFAULT_CONCURRENCY = 1;

/**
 *
 * @param functionsReturningPromise {Array<function>}
 * @param concurrency
 * @returns {Promise<Array>}
 * @private
 */
const _parallelPromises = (
  functionsReturningPromise,
  concurrency,
) => new Promise((resolve, reject) => {
  if ((functionsReturningPromise || []).length === 0) {
    resolve([]);
  }

  const results = new Array(functionsReturningPromise.length);
  let executingCount = 0;
  const waitingFunctions = [...functionsReturningPromise].reverse();
  let enqueue;

  const dequeue = () => {
    executingCount -= 1;
    enqueue();
    if ((waitingFunctions.length === 0) && (executingCount === 0)) {
      resolve(results);
    }
  };
  enqueue = () => {
    // Enqueue to fill concurrency pool
    const limit = Math.min(concurrency || DEFAULT_CONCURRENCY, waitingFunctions.length);
    for (let i = executingCount; i < limit; i += 1) {
      const resultId = functionsReturningPromise.length - waitingFunctions.length;
      results[resultId] = undefined;
      const f = waitingFunctions.pop();
      if (f) {
        executingCount += 1;
        f().then(
          (result) => {
            results[resultId] = result;
            dequeue(resultId, result);
          },
        ).catch(
          (err) => {
            if (process.env.DEBUG) {
              process.stderr.write(`[cpMap]${err}\n`);
            }
            reject(err);
          },
        );
      }
    }
  };
  enqueue();
});

/**
 * Mapper + chainer
 * @param values - array of values
 * @param fn - function returning promises
 * @param concurrency {int} - parallel execution concurrency (default: 1)
 * @returns {Promise<Array>}
 */
const cpMap = async (
  values,
  fn,
  concurrency = DEFAULT_CONCURRENCY,
) => _parallelPromises(
  values.map(
    (value, idx) => (
      (v, i) => () => fn(v, i)
    )(value, idx),
  ),
  concurrency || DEFAULT_CONCURRENCY,
);

module.exports = {
  wait,
  cpMap,
};

