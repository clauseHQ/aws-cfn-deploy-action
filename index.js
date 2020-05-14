const core = require('@actions/core');
const github = require('@actions/github');
const H = require('highland');
const R = require('ramda');
const aws = require('aws-sdk');
const fs = require('fs');

const cfn = H.streamifyAll(new aws.CloudFormation());

const inputs = ['template', 'stack-name', 'capabilities', 'parameters'];
const DEBUG = false;

const waitForStackReady = StackName => cfn.describeStacksStream({ StackName })
  .doto(log('waitForStackReady: describeStacksStream'))
  .map(({ Stacks: [{ StackStatus }] }) => StackStatus)
  .doto(log('waitForStackReady: StackStatus'))
  .errors((error, push) => {
    log('waitForStackReady: describeStacksStream: error')(error);
    return error.message.indexOf('does not exist') !== -1
      ? push(null, 'INIT')
      : push(error);
  })
  .flatMap(StackStatus => H.wrapCallback((StackStatus, callback) => /^.*_FAILED/.test(StackStatus)
    ? callback({ message: `Stack ${StackName} is in the ${StackStatus} state. Fix that before trying to deploy again` })
    : callback(null, StackStatus)
  ))
  .flatMap(StackStatus => /^.*_COMPLETE$/.test(StackStatus) || R.contains(StackStatus, R.keys(StackStatusHandlers))
    ? H([StackStatus])
    : H((push, next) => setTimeout(() => next(waitForStackReady(StackName)), 10000))
  );

const StackStatusHandlers = {
  INIT: ({ StackName, Capabilities, Parameters, TemplateBody }) => cfn.createStackStream({
    StackName,
    Capabilities,
    Parameters,
    TemplateBody
  }),
  ROLLBACK_COMPLETE: ({ StackName }) => cfn.deleteStackStream({ StackName }),
  DEFAULT: ({ StackName, Capabilities, Parameters, TemplateBody }) => cfn.updateStackStream({
    StackName,
    Capabilities,
    Parameters,
    TemplateBody
  })
    .errors((error, push) => error.message === 'No updates are to be performed.'
      ? push(null, {})
      : push(error)
    )
};

const processCapabilities = capabilities => capabilities === '' ? [] : capabilities
  .replace(/^\ +/, '')
  .replace(/\ +$/, '')
  .replace(/\ +/g, ' ')
  .split(' ');

const processParameters = parameters => parameters === '' ? [] : parameters
  .replace(/^\ +/, '')
  .replace(/\ +$/, '')
  .replace(/\ +/g, ' ')
  .split(' ')
  .map(parameter => parameter.split('='))
  .map(([ParameterKey, ParameterValue]) => ({
    ParameterKey,
    ParameterValue
  }));

const log = ctx => obj => {
  if (DEBUG) {
    console.log(ctx);
    console.log(JSON.stringify(obj, null, 2));
  }
};

return H(inputs)
  .map(core.getInput)
  .collect()
  .map(R.zip(inputs))
  .map(R.fromPairs)
  .doto(log('raw input'))
  .map(inputs => ({
    ...inputs,
    StackName: inputs['stack-name'],
    Capabilities: processCapabilities(inputs.capabilities),
    Parameters: processParameters(inputs.parameters)
  }))
  .doto(log('processed input: synchronous'))
  .flatMap(({ template, ...inputs }) => H.wrapCallback(fs.readFile)(template)
    .map(body => body.toString('utf8'))
    .map(TemplateBody => ({
      ...inputs,
      TemplateBody
    }))
  )
  .doto(log('processed input: asynchronous'))
  .flatMap(({ StackName, ...inputs }) => waitForStackReady(StackName)
    .doto(log('first result of waiting for stack'))
    .map(StackStatus => StackStatusHandlers[StackStatus] || StackStatusHandlers['DEFAULT'])
    .flatMap(handler => handler({ StackName, ...inputs }))
    .doto(log('result of operating on stack'))
    .flatMap(() => waitForStackReady(StackName))
    .doto(log('second result of waiting for stack'))
  )
  .doto(() => core.setOutput('time', new Date().toTimeString()))
  .errors(error => {
    console.error(JSON.stringify(error));
    core.setFailed(error.message);
  })
  .each(console.log);
