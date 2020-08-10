const core = require('@actions/core');
const github = require('@actions/github');
const H = require('highland');
const R = require('ramda');
const aws = require('aws-sdk');
const fs = require('fs');

const cfn = H.streamifyAll(new aws.CloudFormation());

const inputKeys = ['template', 'stack-name', 'capabilities', 'parameters'];
const DEBUG = R.isEmpty(core.getInput('debug')) ? false : true;

const log = ctx => obj => {
  if (DEBUG) {
    console.log(ctx);
    console.log(JSON.stringify(obj, null, 2));
  }
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

const getStackInputs = inputKeys => (({
  template: Template,
  'stack-name': StackName,
  capabilities,
  parameters
}) => ({
  Template,
  StackName,
  Capabilities: processCapabilities(capabilities),
  Parameters: processParameters(parameters)
}))(R.fromPairs(R.zip(
  inputKeys,
  inputKeys.map(core.getInput)
)));

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
  .flatMap(H.wrapCallback((StackStatus, callback) => /^.*_FAILED/.test(StackStatus)
    ? callback({ message: `Stack ${StackName} is in the ${StackStatus} state. Fix that before trying to deploy again` })
    : callback(null, StackStatus)
  ))
  .flatMap(StackStatus => /^.*_COMPLETE$/.test(StackStatus) || R.contains(StackStatus, R.keys(StackStatusHandlers))
    ? H([StackStatus])
    : H((push, next) => setTimeout(() => next(waitForStackReady(StackName)), 30000))
  );

const StackStatusHandlers = {
  INIT: ({ StackName, Capabilities, Parameters, TemplateBody }) => H([{
    StackName,
    Capabilities,
    Parameters,
    TemplateBody
  }])
    .doto(({ StackName }) => console.log(`Stack ${StackName} does not exist yet: creating ...`))
    .flatMap(params => cfn.createStackStream(params)),
  ROLLBACK_COMPLETE: ({ StackName }) => H([{ StackName }])
    .doto(({ StackName }) => console.log(`Stack ${StackName} is in ROLLBACK_COMPLETE state: deleting ...`))
    .flatMap(params => cfn.deleteStackStream(params)),
  DEFAULT: ({ StackName, Capabilities, Parameters, TemplateBody, StackStatus }) => H([{
    StackName,
    Capabilities,
    Parameters,
    TemplateBody
  }])
    .doto(({ StackName }) => console.log(`Stack ${StackName} is in ${StackStatus} state: updating ...`))
    .flatMap(params => cfn.updateStackStream(params))
    .errors((error, push) => error.message === 'No updates are to be performed.' ? push(null, {}) : push(error))
};

return H([getStackInputs(inputKeys)])
  .doto(log('processed input: synchronous'))
  .flatMap(({ Template, ...inputs }) => H.wrapCallback(fs.readFile)(Template)
    .map(body => body.toString('utf8'))
    .map(TemplateBody => ({
      ...inputs,
      TemplateBody
    }))
  )
  .doto(log('processed input: asynchronous'))
  .flatMap(({ StackName, ...inputs }) => waitForStackReady(StackName)
    .doto(log('result of waiting for stack: phase 1'))
    .flatMap(StackStatus => (StackStatusHandlers[StackStatus] || StackStatusHandlers['DEFAULT'])({
      StackName,
      ...inputs,
      StackStatus
    }))
    .doto(log('result of operating on stack'))
    .flatMap(() => waitForStackReady(StackName))
    .doto(log('result of waiting for stack: phase 2'))
    .flatMap(StackStatus => {
      if (StackStatus === 'UPDATE_COMPLETE' || StackStatus === 'CREATE_COMPLETE') return H([StackStatus]);
      if (StackStatus === 'INIT') return StackStatusHandlers[StackStatus]({
        StackName,
        ...inputs,
        StackStatus
      })
        .doto(log('result of operating on stack'))
        .flatMap(() => waitForStackReady(StackName))
        .doto(log('result of waiting for stack: phase 3'));
      return H(Promise.reject({ status: StackStatus, message: `Stack ${StackName} deployment failed` }));
    })
  )
  .errors(error => {
    console.error(JSON.stringify(error));
    core.setOutput('status', error.status);
    core.setOutput('message', error.message);
    core.setFailed(error.message);
  })
  .each(StackStatus => {
    console.log(`final status is ${StackStatus}`);
    core.setOutput('status', StackStatus);
  });
