const newman = require('newman');
const { workerData } = require('node:worker_threads');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const cloudWatch = new CloudWatchClient();
const s3 = new S3Client();

exports.start = async (runDetails) => {
  const result = await exports.performRun(runDetails);

  await exports.logRunMetrics(result, runDetails.name);

  if (result.failures?.length) {
    let type = 'Postman Failed Assertions';
    if (runDetails.name) {
      type = `${type} (${runDetails.name})`;
    }

    console.warn(JSON.stringify({ type: type, failures: result.failures }));
  } else if (runDetails.name) {
    console.log(`Successfully ran ${runDetails.name} with no failed assertions`);
  }
};

exports.performRun = async (event) => {
  const collection = await exports.getCollection(event);
  const environment = await exports.getEnvironment(event);
  const result = await exports.runNewman(collection, environment);
  const runReport = exports.processResults(result);

  return runReport;
};

exports.getObjectFromS3 = async (objectKey) => {
  const buffer = await exports.getObjectBuffer(objectKey);
  return JSON.parse(buffer.toString());
};

exports.getObjectBuffer = async (objectKey) => {
  const response = await s3.send(new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: objectKey
  }));

  const stream = response.Body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
};

exports.getDataFromPostman = (type, id, apiKey) => {
  return `https://api.getpostman.com/${type}/${id}?apikey=${apiKey}`;
};

exports.getDataFromS3 = async (objectKey) => {
  const data = await exports.getObjectFromS3(objectKey);

  return data;
};

exports.getCollection = async (event) => {
  if (event.postmanCollectionId) {
    return exports.getDataFromPostman('collections', event.postmanCollectionId, event.postmanApiKey);
  }

  return await exports.getDataFromS3(event.s3CollectionPath);
};

exports.getEnvironment = async (event) => {
  if (event.postmanEnvironmentId) {
    return exports.getDataFromPostman('environments', event.postmanEnvironmentId, event.postmanApiKey);
  } else if (event.s3EnvironmentPath) {
    return await exports.getDataFromS3(event.s3EnvironmentPath);
  }
};

exports.runNewman = async (collection, environment) => {
  return new Promise((resolve, reject) => {
    newman.run({
      collection: collection,
      ...environment && { environment: environment },
      reporters: 'json',
      reporter: {
        json: {
          export: '/tmp/'
        }
      }
    }, function (err, result) {
      if (err) reject(err)

      resolve(result.run);
    });
  });
};

exports.processResults = (result) => {
  const failures = result.failures.map(failure => {
    return {
      request: failure.source.name,
      url: `${failure.source.request.method} ${failure.source.request.url.host.join('.')}${failure.source.request.url.path.length ? '/' + failure.source.request.url.path.join('/') : ''}`,
      test: failure.error.test,
      message: failure.error.message
    }
  });
  const report = {
    stats: {
      requests: result.stats.requests,
      assertions: result.stats.assertions,
      prerequestScripts: result.stats.prerequestScripts,
      averageResponseTime: result.timings.responseAverage,
      runTime: result.timings.completed - result.timings.started
    },
    failures
  }

  return report;
};

exports.logRunMetrics = async (result, name) => {
  const command = new PutMetricDataCommand({
    Namespace: 'load-test',
    MetricData: [
      {
        MetricName: 'total-runs',
        Value: 1,
        Unit: 'Count'
      },
      {
        MetricName: 'failed-assertions',
        Value: result.stats.assertions.failed,
        Unit: 'Count'
      },
      {
        MetricName: 'successful-assertions',
        Value: result.stats.assertions.total - result.stats.assertions.pending - result.stats.assertions.failed,
        Unit: 'Count'
      },
      {
        MetricName: 'average-run-duration',
        Value: result.stats.runTime,
        Unit: 'Milliseconds'
      },
      {
        MetricName: 'average-response-time',
        Value: result.stats.averageResponseTime,
        Unit: 'Milliseconds'
      }
    ]
  });

  if (name) {
    command.input.MetricData.push({
      MetricName: 'runs',
      Value: 1,
      Unit: 'Count',
      Dimensions: [
        {
          Name: 'Collection',
          Value: name
        }
      ]
    });

    command.input.MetricData.push({
      MetricName: 'average-duration',
      Value: result.stats.runTime,
      Unit: 'Milliseconds',
      Dimensions: [
        {
          Name: 'Collection',
          Value: name
        }
      ]
    });

    command.input.MetricData.push({
      MetricName: 'average-response-time',
      Value: result.stats.averageResponseTime,
      Unit: 'Milliseconds',
      Dimensions: [
        {
          Name: 'Collection',
          Value: name
        }
      ]
    });

    command.input.MetricData.push({
      MetricName: 'failed-assertions',
      Value: result.stats.assertions.failed,
      Unit: 'Count',
      Dimensions: [
        {
          Name: 'Collection',
          Value: name
        }
      ]
    })
  }

  await cloudWatch.send(command);
};

(async () => {
  await exports.start(workerData.runDetails)
})();
