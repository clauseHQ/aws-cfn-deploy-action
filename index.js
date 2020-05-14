const core = require('@actions/core');
const github = require('@actions/github');
const H = require('highland');
const R = require('ramda');
const aws = require('aws-sdk');
const fs = require('fs');

const cfn = H.streamifyAll(new aws.CloudFormation());

const inputs = ['template', 'stack-name', 'capabilities', 'parameters'];

const waitForStackReady = StackName => cfn.describeStacksStream({ StackName })
  .doto(log('waitForStackReady: describeStacksStream'))
  .map(({ Stacks: [{ StackStatus }] }) => StackStatus)
  .doto(log('waitForStackReady: StackStatus'))
  .errors((error, push) => error.message.indexOf('does not exist') !== -1
    ? push(null, 'INIT')
    : push(error)
  )
  .flatMap(StackStatus => /^.*_COMPLETE$/.test(StackStatus)
    ? H([StackStatus])
    : H((push, next) => setTimeout(() => next(waitForStackReady(StackName)), 10000))
  );

const StatusHandlers = {
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
  console.log(ctx);
  console.log(JSON.stringify(obj, null, 2));
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
    .map(StackStatus => StatusHandlers[StackStatus] || StatusHandlers['DEFAULT'])
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
/*
      - name: cloudformation deploy
        env:
          TEMPLATE: cfn-template.yml
          AWS_STACK_NAME: ${{ needs.setup.outputs.repository-name }}
          CAPABILITIES: CAPABILITY_NAMED_IAM
          PARAMETER_OVERRIDES: ContainerImageUrl=${{ steps.build-image.outputs.image-url }} IntegrationTestLambdaS3Key=${{ steps.build-tests.outputs.s3-key }} Environment=Dev
        run: |
          AWS_CFN_CMD="aws cloudformation"
          STACK_ARG="--stack-name ${AWS_STACK_NAME}"
          if ${AWS_CFN_CMD} describe-stacks ${STACK_ARG} > /dev/null 2>&1; then
            CFN_STATE=$(${AWS_CFN_CMD} describe-stacks ${STACK_ARG} --query 'Stacks[0].StackStatus' --output text)
            if [[ "${CFN_STATE}" == "ROLLBACK_COMPLETE" ]]; then
              echo "cfn state is ${CFN_STATE}: deleting ..."
              ${AWS_CFN_CMD} delete-stack ${STACK_ARG}
              ${AWS_CFN_CMD} wait stack-delete-complete ${STACK_ARG}
            else
              while [[ "${CFN_STATE}" != *"_COMPLETE" ]]; do
                echo "cfn state is ${CFN_STATE}: waiting ..."
                sleep 10
                CFN_STATE=$(${AWS_CFN_CMD} describe-stacks ${STACK_ARG} --query 'Stacks[0].StackStatus' --output text)
                if [[ "${CFN_STATE}" == *"_FAILED" ]]; then
                  echo "cfn state is ${CFN_STATE}: first fix this and deploy again"
                  exit 1
                fi
              done
            fi
          fi
          ${AWS_CFN_CMD} deploy --template-file ${TEMPLATE} ${STACK_ARG} --parameter-overrides ${PARAMETER_OVERRIDES} --capabilities ${CAPABILITIES} --no-fail-on-empty-changeset

try {
  // `who-to-greet` input defined in action metadata file
  const nameToGreet = core.getInput('who-to-greet');
  console.log(`Hello ${nameToGreet}!`);
  const time = (new Date()).toTimeString();
  core.setOutput("time", time);
  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2)
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}*/
