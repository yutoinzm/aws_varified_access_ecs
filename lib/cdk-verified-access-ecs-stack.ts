import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

export interface VerifiedAccessEcsStackProps extends cdk.StackProps {
  /**
   * 管理者グループID
   * IAM Identity CenterのグループIDを指定
   * /admin/* と /hr-admin/* にアクセス可能
   * 例: 'g-1234567890abcdef'
   */
  adminGroupId: string;
  
  /**
   * 人事部グループID
   * IAM Identity CenterのグループIDを指定
   * /hr/* と /hr-admin/* にアクセス可能
   * 例: 'f79d6ad8-1da1-7b36-4ad3-53dad7cc2iff'
   */
  hrGroupId: string;
  
  /**
   * アプリケーションドメイン名（Verified Access Endpoint用）
   * 例: 'verified-access-ecs.example.com'
   */
  applicationDomain: string;
  
  /**
   * ACM証明書のARN（Verified Access Endpoint用）
   * 例: 'arn:aws:acm:ap-northeast-1:123456789012:certificate/abc123...'
   */
  domainCertificateArn: string;
}

export class CdkVerifiedAccessEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VerifiedAccessEcsStackProps) {
    super(scope, id, props);

    // =========================================
    // 0. デプロイ条件の設定
    // =========================================
    // 初回デプロイかどうかを判定するパラメータ
    const isFirstDeploy = new cdk.CfnParameter(this, 'IsFirstDeploy', {
      type: 'String',
      default: 'true',
      allowedValues: ['true', 'false'],
      description: '初回デプロイの場合はtrue、2回目以降はfalse',
    });

    // 条件の作成
    const isFirstDeployCondition = new cdk.CfnCondition(this, 'IsFirstDeployCondition', {
      expression: cdk.Fn.conditionEquals(isFirstDeploy.valueAsString, 'true'),
    });
    
    const isNotFirstDeployCondition = new cdk.CfnCondition(this, 'IsNotFirstDeployCondition', {
      expression: cdk.Fn.conditionNot(isFirstDeployCondition),
    });

    // =========================================
    // 1. VPC作成
    // =========================================
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1, // ECS Fargateは外部通信が必要なのでNAT Gateway追加
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // =========================================
    // 2. セキュリティグループ
    // =========================================
    // ALB用セキュリティグループ
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });

    // Verified AccessからALBへのHTTPアクセス許可
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP from VPC (Verified Access)'
    );

    // ECS Fargate用セキュリティグループ
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS Fargate tasks',
      allowAllOutbound: true,
    });

    // ALBからECS Fargateへのアクセス許可
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(80),
      'Allow HTTP from ALB'
    );

    // =========================================
    // 3. Application Load Balancer
    // =========================================
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false, // Verified Access EndpointにはInternal ALBが必要
      securityGroup: albSecurityGroup,
    });

    // ターゲットグループ（ECS Fargate用）
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP, // Fargateの場合はIPターゲットタイプ
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // HTTPリスナー
    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    // =========================================
    // 4. ECS Cluster
    // =========================================
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'verified-access-ecs-cluster',
      containerInsights: true, // CloudWatch Container Insightsを有効化
    });

    // =========================================
    // 5. Dockerイメージのビルド
    // =========================================
    // Dockerfileがあるディレクトリからイメージをビルド
    const dockerImage = new ecr_assets.DockerImageAsset(this, 'WebAppImage', {
      directory: path.join(__dirname, '../docker'),
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // =========================================
    // 6. ECS Task Definition
    // =========================================
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 512,  // メモリ: 512MB
      cpu: 256,              // CPU: 0.25 vCPU
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // コンテナの追加
    const container = taskDefinition.addContainer('WebAppContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'webapp',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    // =========================================
    // 7. ECS Service
    // =========================================
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 2, // 初期タスク数: 2
      assignPublicIp: false, // プライベートサブネットに配置
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ecsSecurityGroup],
      serviceName: 'verified-access-webapp-service',
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    // ターゲットグループにECS Serviceを登録
    service.attachToApplicationTargetGroup(targetGroup);

    // Auto Scaling設定
    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,  // 最小タスク数
      maxCapacity: 4,  // 最大タスク数
    });

    // CPU使用率ベースのスケーリング
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // メモリ使用率ベースのスケーリング
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // =========================================
    // 8. CloudWatch Logsグループ（Verified Access用）
    // =========================================
    const logGroup = new logs.LogGroup(this, 'VerifiedAccessLogs', {
      logGroupName: '/aws/verifiedaccess/ecs',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================
    // 9. Verified Access Trust Provider (IAM Identity Center)
    // =========================================
    const trustProvider = new ec2.CfnVerifiedAccessTrustProvider(
      this,
      'TrustProvider',
      {
        policyReferenceName: 'IAMIdentityCenter',
        trustProviderType: 'user',
        userTrustProviderType: 'iam-identity-center',
        description: 'IAM Identity Center trust provider for ECS',
      }
    );

    // =========================================
    // 10. Verified Access Instance
    // =========================================
    const verifiedAccessInstance = new ec2.CfnVerifiedAccessInstance(
      this,
      'VerifiedAccessInstance',
      {
        description: 'Verified Access for ECS Fargate with path-based control',
        verifiedAccessTrustProviderIds: [trustProvider.attrVerifiedAccessTrustProviderId],
        loggingConfigurations: {
          cloudWatchLogs: {
            enabled: true,
            logGroup: logGroup.logGroupName,
          },
        },
      }
    );
    verifiedAccessInstance.addDependency(trustProvider);

    // =========================================
    // 11. Verified Access Group（パスベースアクセス制御ポリシー）
    // =========================================
    // サポート情報を元に実装:
    // - /admin/* へのアクセスは管理者のみ許可
    // - /hr/* へのアクセスは人事部ユーザーのみ許可
    // - /hr-admin/* へのアクセスは人事部かつ管理者のみ許可
    // - その他のパスは認証済みユーザーは全て許可
    // 
    // 参考:
    // - like演算子: https://docs.aws.amazon.com/verified-access/latest/ug/built-in-policy-operators.html
    // - グループ指定: https://docs.aws.amazon.com/verified-access/latest/ug/trust-data-iam-add-pol.html#example-policy-iam-identity-center
    // - ポリシー評価: https://docs.aws.amazon.com/verified-access/latest/ug/auth-policies-policy-eval.html
    
    const policyReferenceName = 'IAMIdentityCenter';
    
    // 管理者グループIDの条件を構築
    const adminGroupCondition = `context.${policyReferenceName}.groups has "${props.adminGroupId}"`;
    
    // 人事部グループIDの条件を構築
    const hrGroupCondition = `context.${policyReferenceName}.groups has "${props.hrGroupId}"`;
    
    // ポリシードキュメントを構築
    // 動作確認済みのポリシーに基づいて実装
    // 注意: path like のパターンから最初の "/" を削除（"admin/*" のように記述）
    const permitParts: string[] = [];
    
    // 1. admin/* へのアクセス: 管理者グループのみ許可
    permitParts.push(
      `permit(principal, action, resource) when {
  context.http_request.path like "admin/*" &&
  (${adminGroupCondition})
};`
    );
    
    // 2. hr/* へのアクセス: 人事部グループのユーザーのみ許可
    // 注意: /hr-admin/* を除外するため、/hr-admin/* のチェックは "/" 付きで記述
    permitParts.push(
      `permit(principal, action, resource) when {
  context.http_request.path like "hr/*" &&
  !(context.http_request.path like "/hr-admin/*") &&
  (${hrGroupCondition})
};`
    );
    
    // 3. hr-admin/* へのアクセス: 人事部グループかつ管理者グループのみ許可
    permitParts.push(
      `permit(principal, action, resource) when {
  context.http_request.path like "hr-admin/*" &&
  (${adminGroupCondition}) &&
  (${hrGroupCondition})
};`
    );
    
    // 4. その他のパス: 認証済みユーザーは全て許可
    // admin/*, hr/*, hr-admin/* 以外のすべてのパスを許可
    permitParts.push(
      `permit(principal, action, resource) when {
  !(context.http_request.path like "admin/*") &&
  !(context.http_request.path like "hr/*") &&
  !(context.http_request.path like "hr-admin/*")
};`
    );
    
    // permitのみを使用（forbidは削除）
    // Cedarの評価ルール: 少なくとも1つのpermitが合致すれば許可
    const policyDocument = permitParts.join('\n\n');

    const verifiedAccessGroup = new ec2.CfnVerifiedAccessGroup(
      this,
      'VerifiedAccessGroup',
      {
        verifiedAccessInstanceId: verifiedAccessInstance.attrVerifiedAccessInstanceId,
        description: 'Group for ECS Fargate with path-based access control',
        policyDocument: policyDocument,
        policyEnabled: true,
      }
    );

    verifiedAccessGroup.addDependency(trustProvider);
    verifiedAccessGroup.addDependency(verifiedAccessInstance);

    // =========================================
    // 12. Verified Access Endpoint (HTTPS)
    // =========================================
    const endpointDomainPrefix = 'verified-access-ecs';
    
    const endpoint = new ec2.CfnVerifiedAccessEndpoint(
      this,
      'HttpsEndpoint',
      {
        endpointDomainPrefix: endpointDomainPrefix,
        applicationDomain: props.applicationDomain,
        domainCertificateArn: props.domainCertificateArn,
        attachmentType: 'vpc',
        endpointType: 'load-balancer',
        securityGroupIds: [albSecurityGroup.securityGroupId],
        loadBalancerOptions: {
          loadBalancerArn: alb.loadBalancerArn,
          port: 80,
          protocol: 'http',
          subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
        },
        verifiedAccessGroupId: verifiedAccessGroup.attrVerifiedAccessGroupId,
        description: 'HTTPS endpoint for ECS Fargate with path-based control',
      }
    );

    endpoint.cfnOptions.condition = isNotFirstDeployCondition;
    endpoint.addDependency(verifiedAccessGroup);
    endpoint.addDependency(alb.node.defaultChild as cdk.CfnResource);

    // =========================================
    // 13. 出力
    // =========================================
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      description: 'ECS Service Name',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });

    new cdk.CfnOutput(this, 'TargetGroupArn', {
      value: targetGroup.targetGroupArn,
      description: 'Target Group ARN',
    });

    const endpointUrlOutput = new cdk.CfnOutput(this, 'VerifiedAccessEndpointUrl', {
      value: `https://${props.applicationDomain}`,
      description: 'Verified Access Endpoint URL (HTTPS) - カスタムドメイン',
    });
    endpointUrlOutput.condition = isNotFirstDeployCondition;

    new cdk.CfnOutput(this, 'VerifiedAccessInstanceId', {
      value: verifiedAccessInstance.attrVerifiedAccessInstanceId,
      description: 'Verified Access Instance ID',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch Logs Group Name',
    });
  }
}

