#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkVerifiedAccessEcsStack } from '../lib/cdk-verified-access-ecs-stack';

const app = new cdk.App();

// 環境変数から設定を取得
const adminGroupId = process.env.ADMIN_GROUP_ID || ''; // IAM Identity Centerの管理者グループID
const hrGroupId = process.env.HR_GROUP_ID || ''; // IAM Identity Centerの人事部グループID
const applicationDomain = process.env.APPLICATION_DOMAIN || 'verified-access-ecs.example.com';
const domainCertificateArn = process.env.DOMAIN_CERTIFICATE_ARN || '';

if (!adminGroupId) {
  throw new Error('ADMIN_GROUP_ID environment variable is required');
}

if (!hrGroupId) {
  throw new Error('HR_GROUP_ID environment variable is required');
}

new CdkVerifiedAccessEcsStack(app, 'CdkVerifiedAccessEcsStack', {
  adminGroupId: adminGroupId.trim(),
  hrGroupId: hrGroupId.trim(),
  applicationDomain,
  domainCertificateArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
  },
});

