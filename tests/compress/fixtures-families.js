'use strict';
/**
 * Quality fixtures — command families without a dedicated Node processor,
 * compressed by the token-saver processors in auto mode (kubectl, terraform,
 * maven, npm). Deterministic, synthetic data only.
 */
const { hex, range, word } = require('./gen');

const STATES = ['Running', 'Running', 'Running', 'Completed', 'Running'];
const kubectlPods = [
  'NAME                                   READY   STATUS             RESTARTS      AGE',
  ...range(180).map((i) => `${word(i)}-${hex(i, 10)}-${hex(i + 7, 5)}`.padEnd(39) +
    `${i % 5 === 3 ? '0/1' : '1/1'}     ${STATES[i % 5].padEnd(19)}${String(i % 3).padEnd(14)}${(i % 9) + 1}d`),
  'payments-worker-6f7c9d8b4-x2k9p        0/1     CrashLoopBackOff   14 (2m ago)   3h',
  ...range(40).map((i) => `${word(i + 3)}-job-${hex(i + 300, 8)}`.padEnd(39) + '0/1     Completed          0             12d'),
  '',
].join('\n');

const tfResource = (i) => [
  `  # aws_instance.${word(i)}_${i} will be created`,
  `  + resource "aws_instance" "${word(i)}_${i}" {`,
  `      + ami                          = "ami-${hex(i, 17)}"`,
  '      + arn                          = (known after apply)',
  '      + associate_public_ip_address  = (known after apply)',
  '      + availability_zone            = (known after apply)',
  '      + id                           = (known after apply)',
  '      + instance_type                = "t3.micro"',
  '      + private_ip                   = (known after apply)',
  '      + tags                         = {',
  `          + "Name" = "${word(i)}-${i}"`,
  '        }',
  '    }',
  '',
];
const terraformPlan = [
  'Refreshing state... [id=vpc-0a1b2c3d]',
  ...range(12).map((i) => `aws_subnet.${word(i)}: Refreshing state... [id=subnet-${hex(i, 8)}]`),
  '',
  'Terraform used the selected providers to generate the following execution plan. Resource actions are',
  'indicated with the following symbols:',
  '  + create',
  '  ~ update in-place',
  '  - destroy',
  '',
  'Terraform will perform the following actions:',
  '',
  ...range(30).flatMap(tfResource),
  '  # aws_s3_bucket.logs will be destroyed',
  '  - resource "aws_s3_bucket" "logs" {',
  '      - bucket = "acme-logs-archive" -> null',
  '    }',
  '',
  'Plan: 30 to add, 0 to change, 1 to destroy.',
  '',
  '╷',
  '│ Warning: Argument is deprecated',
  '│ ',
  '│   with aws_s3_bucket.assets,',
  '│   on storage.tf line 12, in resource "aws_s3_bucket" "assets":',
  '╵',
  '',
].join('\n');

const mvnTest = [
  '[INFO] Scanning for projects...',
  '[INFO] ------------------------< com.example:billing >-------------------------',
  '[INFO] Building billing 1.4.0-SNAPSHOT',
  ...range(60).map((i) => `[INFO] Downloading from central: https://repo.maven.apache.org/maven2/org/${word(i)}/${word(i + 1)}/${i}.0/${word(i)}-${i}.0.pom`),
  ...range(60).map((i) => `[INFO] Downloaded from central: https://repo.maven.apache.org/maven2/org/${word(i)}/${word(i + 1)}/${i}.0/${word(i)}-${i}.0.pom (${i + 2} kB at ${i * 3} kB/s)`),
  '[INFO] --- maven-surefire-plugin:3.2.5:test (default-test) @ billing ---',
  '[INFO] -------------------------------------------------------',
  '[INFO]  T E S T S',
  '[INFO] -------------------------------------------------------',
  ...range(40).map((i) => `[INFO] Running com.example.billing.${word(i)[0].toUpperCase()}${word(i).slice(1)}Test\n[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.0${i % 9} s`),
  '[INFO] Running com.example.billing.InvoiceServiceTest',
  '[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.21 s <<< FAILURE! -- in com.example.billing.InvoiceServiceTest',
  '[ERROR] com.example.billing.InvoiceServiceTest.totalIncludesVat -- Time elapsed: 0.02 s <<< FAILURE!',
  'org.opentest4j.AssertionFailedError: expected: <120.00> but was: <100.00>',
  '\tat com.example.billing.InvoiceServiceTest.totalIncludesVat(InvoiceServiceTest.java:42)',
  '[INFO] Results:',
  '[ERROR] Failures: ',
  '[ERROR]   InvoiceServiceTest.totalIncludesVat:42 expected: <120.00> but was: <100.00>',
  '[ERROR] Tests run: 124, Failures: 1, Errors: 0, Skipped: 0',
  '[INFO] BUILD FAILURE',
  '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test (default-test) on project billing: There are test failures.',
  '',
].join('\n');

module.exports = [
  {
    name: 'kubectl get pods (crash in the middle)',
    cmd: 'kubectl get pods -A',
    exitCode: 0,
    input: kubectlPods,
    mustPreserve: ['payments-worker-6f7c9d8b4-x2k9p', 'CrashLoopBackOff', 'NAME'],
    minSavingsPercent: 30,
  },
  {
    name: 'terraform plan (31 changes, warning)',
    cmd: 'terraform plan',
    exitCode: 0,
    input: terraformPlan,
    mustPreserve: ['Plan: 30 to add, 0 to change, 1 to destroy.', 'aws_s3_bucket.logs will be destroyed',
      'Warning: Argument is deprecated'],
    minSavingsPercent: 50,
  },
  {
    name: 'mvn test failure',
    cmd: 'mvn test',
    exitCode: 1,
    input: mvnTest,
    mustPreserve: ['InvoiceServiceTest.totalIncludesVat:42 expected: <120.00> but was: <100.00>',
      'Tests run: 124, Failures: 1', 'BUILD FAILURE'],
    minSavingsPercent: 50,
  },
];
