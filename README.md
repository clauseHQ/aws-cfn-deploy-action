# aws-cfn-deploy github action

This action performs an AWS CloudFormation deployment, handling all states properly and waiting for current updates & rollbacks to complete 

## Inputs

### `template`

**Required** The name of the cloudformation template.

### `stack-name`

**Required** The name of the cloudformation stack.

### `capabilities`

A space-separated list of stack capabilities.

### `parameters`

A space-separated list of stack parameters, each formatted as `Key=Value`.

## Advanced inputs

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
uses: clausehq/aws-cfn-deploy-action@v1.0.4
with:
  template: cfn-template-yml
  stack-name: my-test-stack
  capabilities: CAPABILITY_IAM CAPABILITY_NAMED_IAM
  parameters: Parameter0=Value0 Parameter1=Value1
```

## Extending and Testing

Tests in this repository are run by means of [GitHub Actions](https://github.com/clauseHQ/aws-cfn-deploy-action/actions).
There are a number of [Repository Secrets](https://github.com/clauseHQ/aws-cfn-deploy-action/settings/secrets) that need to be created in order for these tests to be able to run. 

### AWS Access Keys

1. Create a new IAM user in the AWS Account where you want these tests to create and delete cloudformation stacks
2. Choose `Programmatic Access` when being asked to select an Access Type
3. When being asked to configure user permissions, choose `Attach existing policies directly`
4. Click `Create Policy`
5. Select the `JSON` tab
6. Configure the following policy:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*"
            ],
            "Resource": "arn:aws:cloudformation:YOUR_REGION:YOUR_AWS_ACCOUNT_NR:stack/aws-cfn-deploy-action-test/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:*"
            ],
            "Resource": "*"
        }
    ]
}
```
7. Set the user's AWS access key id as the value of a Repository Secret named `AWS_ACCESS_KEY_ID`
8. Set the user's AWS secret access key as the value of a Repository Secret named `AWS_SECRET_ACCESS_KEY`

### Slack Incoming Webhook

1. Configure an incoming webhook to the slack channel where you want to receive failure notifications
2. Set the webhook url as the value of a Repository Secret named `SLACK_WEBHOOK_URL` 

### _Delete AWS User and Secrets, and Slack Webhook Secret when you're done testing_
