# aws-cfn-deploy github action

This action performs an AWS CloudFormation deployment, handling all states properly and waiting for current updates & rollbacks to complete 

## Inputs

### `template`

**Required** The name of the cloudformation template.

### `stack-name`

**Required** The name of the cloudformation stack.

### `capabilities`

A space-separated list of stack capabilities.

## Advanced inputs

### `parameters`

A space-separated list of stack parameters, each formatted as `Key=Value`.

### `never-fail`

Always pass the GitHub workflow step, even if the deployment fails (useful for running tests)

### `debug`

Debug-level logging of all cloudformation api commands and their responses

## Outputs

### `stack-status`

The final status of the stack being deployed

### `message`

An error message, if the stack ends in a failed state

## Example usage

```yml
uses: adriaan-pelzer/aws-cfn-deploy-action@v1.0.4
with:
  template: cfn-template-yml
  stack-name: my-test-stack
  capabilities: CAPABILITY_IAM CAPABILITY_NAMED_IAM
  parameters: Parameter0=Value0 Parameter1=Value1
```
