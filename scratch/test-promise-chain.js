let queue = Promise.resolve();

function addToQueue(id, shouldFail) {
  return new Promise((resolve, reject) => {
    queue = queue.then(async () => {
      console.log(`Running ${id}`);
      if (shouldFail) {
        reject(new Error(`Failed ${id}`));
      } else {
        resolve(`Success ${id}`);
      }
    });
  });
}

(async () => {
  try {
    const res1 = await addToQueue(1, false);
    console.log("Result 1:", res1);
  } catch (e) {
    console.log("Error 1:", e.message);
  }

  try {
    const res2 = await addToQueue(2, true);
    console.log("Result 2:", res2);
  } catch (e) {
    console.log("Error 2:", e.message);
  }

  try {
    const res3 = await addToQueue(3, false);
    console.log("Result 3:", res3);
  } catch (e) {
    console.log("Error 3:", e.message);
  }
})();
