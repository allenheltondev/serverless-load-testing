const fs = require('fs');
const { Worker } = require('node:worker_threads');

exports.handler = async (event) => {
  await Promise.all(event.Records.map((record) => exports.runCollection(JSON.parse(record.body))));

  exports.cleanupNewmanReports();
};

exports.cleanupNewmanReports = () => {
  const fileNames = fs.readdirSync('/tmp/');
  for (let fileName of fileNames) {
    fs.unlinkSync(`/tmp/${fileName}`);
  }
};

exports.runCollection = (runDetails) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./runner/newman-runner.js', { workerData: { runDetails } });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Newman exited with ${code}`));
      } else {
        resolve();
      }
    });
  });
}
