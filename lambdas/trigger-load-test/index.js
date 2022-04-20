const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const sqs = new SQSClient();

exports.handler = async (event) => {
  const distributions = exports.getValidDistributions(event.distributions);
  if (!distributions.length) {
    console.error('No valid collections were provided.');
    return;
  }

  let distributionTotal = 0;
  distributions.map(d => distributionTotal += d.percentage);
  if (distributionTotal != 100) {
    console.error('Provided collection distributions do not equal 100.');
    return;
  }

  const events = exports.createLoadTestEvents(event.count ?? 1000, distributions);

  await exports.queueEvents(events);
};

exports.getValidDistributions = (distributions) => {
  const validDistributions = [];
  distributions.map(d => {
    if ((d.postmanCollectionId || d.postmanEnvironmentId) && !d.postmanApiKey) {
      console.warn(`${d.name} uses a Postman collection or environment but does not have an API key provided.`);
    }
    if (!d.postmanCollectionId && !d.s3CollectionPath) {
      console.warn(`${d.name} does not have a collection provided.`);
    }

    if (!d.percentage) {
      console.log(`${d.name} was not given a distribution percentage, so it will be defaulted to 100%.`);
      d.percentage = 100;
    }

    validDistributions.push(d);
  });

  return validDistributions;
};

exports.createLoadTestEvents = (count, distributions) => {
  const events = [];
  distributions.map(distribution => {
    const eventCount = Math.ceil(count * distribution.percentage / 100);
    for (let i = 0; i < eventCount; i++) {
      events.push({
        ...distribution.name && { name: distribution.name },
        ...distribution.s3CollectionPath && { s3CollectionPath: distribution.s3CollectionPath },
        ...distribution.postmanApiKey && { postmanApiKey: distribution.postmanApiKey },
        ...distribution.postmanCollectionId && { postmanCollectionId: distribution.postmanCollectionId },
        ...distribution.s3EnvironmentPath && { s3EnvironmentPath: distribution.s3EnvironmentPath },
        ...distribution.postmanEnvironmentId && { postmanEnvironmentId: distribution.postmanEnvironmentId }
      })
    }
  });

  return events;
};

exports.createMessageBatchCommands = (events) => {
  const commands = [];
  while (events.length) {
    const batch = events.splice(0, 10);
    commands.push(new SendMessageBatchCommand({
      Entries: batch.map((item, index) => {
        return {
          MessageBody: JSON.stringify(item),
          Id: `${index}`
        }
      }),
      QueueUrl: process.env.QUEUE_URL
    }));
  }

  return commands;
};

exports.queueEvents = async (events) => {
  const commands = exports.createMessageBatchCommands(events);
  await Promise.all(commands.map(async (command) => {
    await sqs.send(command);
  }));
};