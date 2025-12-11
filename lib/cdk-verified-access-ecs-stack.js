"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkVerifiedAccessEcsStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const ecr_assets = __importStar(require("aws-cdk-lib/aws-ecr-assets"));
const path = __importStar(require("path"));
class CdkVerifiedAccessEcsStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        albSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80), 'Allow HTTP from VPC (Verified Access)');
        // ECS Fargate用セキュリティグループ
        const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
            vpc,
            description: 'Security group for ECS Fargate tasks',
            allowAllOutbound: true,
        });
        // ALBからECS Fargateへのアクセス許可
        ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow HTTP from ALB');
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
            memoryLimitMiB: 512, // メモリ: 512MB
            cpu: 256, // CPU: 0.25 vCPU
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
            minCapacity: 1, // 最小タスク数
            maxCapacity: 4, // 最大タスク数
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
        const trustProvider = new ec2.CfnVerifiedAccessTrustProvider(this, 'TrustProvider', {
            policyReferenceName: 'IAMIdentityCenter',
            trustProviderType: 'user',
            userTrustProviderType: 'iam-identity-center',
            description: 'IAM Identity Center trust provider for ECS',
        });
        // =========================================
        // 10. Verified Access Instance
        // =========================================
        const verifiedAccessInstance = new ec2.CfnVerifiedAccessInstance(this, 'VerifiedAccessInstance', {
            description: 'Verified Access for ECS Fargate with path-based control',
            verifiedAccessTrustProviderIds: [trustProvider.attrVerifiedAccessTrustProviderId],
            loggingConfigurations: {
                cloudWatchLogs: {
                    enabled: true,
                    logGroup: logGroup.logGroupName,
                },
            },
        });
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
        const permitParts = [];
        // 1. admin/* へのアクセス: 管理者グループのみ許可
        permitParts.push(`permit(principal, action, resource) when {
  context.http_request.path like "admin/*" &&
  (${adminGroupCondition})
};`);
        // 2. hr/* へのアクセス: 人事部グループのユーザーのみ許可
        // 注意: /hr-admin/* を除外するため、/hr-admin/* のチェックは "/" 付きで記述
        permitParts.push(`permit(principal, action, resource) when {
  context.http_request.path like "hr/*" &&
  !(context.http_request.path like "/hr-admin/*") &&
  (${hrGroupCondition})
};`);
        // 3. hr-admin/* へのアクセス: 人事部グループかつ管理者グループのみ許可
        permitParts.push(`permit(principal, action, resource) when {
  context.http_request.path like "hr-admin/*" &&
  (${adminGroupCondition}) &&
  (${hrGroupCondition})
};`);
        // 4. その他のパス: 認証済みユーザーは全て許可
        // admin/*, hr/*, hr-admin/* 以外のすべてのパスを許可
        permitParts.push(`permit(principal, action, resource) when {
  !(context.http_request.path like "admin/*") &&
  !(context.http_request.path like "hr/*") &&
  !(context.http_request.path like "hr-admin/*")
};`);
        // permitのみを使用（forbidは削除）
        // Cedarの評価ルール: 少なくとも1つのpermitが合致すれば許可
        const policyDocument = permitParts.join('\n\n');
        const verifiedAccessGroup = new ec2.CfnVerifiedAccessGroup(this, 'VerifiedAccessGroup', {
            verifiedAccessInstanceId: verifiedAccessInstance.attrVerifiedAccessInstanceId,
            description: 'Group for ECS Fargate with path-based access control',
            policyDocument: policyDocument,
            policyEnabled: true,
        });
        verifiedAccessGroup.addDependency(trustProvider);
        verifiedAccessGroup.addDependency(verifiedAccessInstance);
        // =========================================
        // 12. Verified Access Endpoint (HTTPS)
        // =========================================
        const endpointDomainPrefix = 'verified-access-ecs';
        const endpoint = new ec2.CfnVerifiedAccessEndpoint(this, 'HttpsEndpoint', {
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
        });
        endpoint.cfnOptions.condition = isNotFirstDeployCondition;
        endpoint.addDependency(verifiedAccessGroup);
        endpoint.addDependency(alb.node.defaultChild);
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
exports.CdkVerifiedAccessEcsStack = CdkVerifiedAccessEcsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXZlcmlmaWVkLWFjY2Vzcy1lY3Mtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjZGstdmVyaWZpZWQtYWNjZXNzLWVjcy1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFFbkMseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyw4RUFBZ0U7QUFDaEUsMkRBQTZDO0FBQzdDLHVFQUF5RDtBQUN6RCwyQ0FBNkI7QUFnQzdCLE1BQWEseUJBQTBCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw0Q0FBNEM7UUFDNUMsZUFBZTtRQUNmLDRDQUE0QztRQUM1Qyx1QkFBdUI7UUFDdkIsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDaEUsSUFBSSxFQUFFLFFBQVE7WUFDZCxPQUFPLEVBQUUsTUFBTTtZQUNmLGFBQWEsRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUM7WUFDaEMsV0FBVyxFQUFFLDRCQUE0QjtTQUMxQyxDQUFDLENBQUM7UUFFSCxRQUFRO1FBQ1IsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ2xGLFVBQVUsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLGVBQWUsQ0FBQyxhQUFhLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQztTQUN4RSxDQUFDLENBQUM7UUFFSCxNQUFNLHlCQUF5QixHQUFHLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDeEYsVUFBVSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLHNCQUFzQixDQUFDO1NBQ3hELENBQUMsQ0FBQztRQUVILDRDQUE0QztRQUM1QyxXQUFXO1FBQ1gsNENBQTRDO1FBQzVDLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ25DLE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUMsRUFBRSxzQ0FBc0M7WUFDdEQsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxTQUFTO29CQUNmLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtpQkFDL0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILDRDQUE0QztRQUM1QyxnQkFBZ0I7UUFDaEIsNENBQTRDO1FBQzVDLGlCQUFpQjtRQUNqQixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDdkUsR0FBRztZQUNILFdBQVcsRUFBRSx3QkFBd0I7WUFDckMsZ0JBQWdCLEVBQUUsSUFBSTtTQUN2QixDQUFDLENBQUM7UUFFSCxtQ0FBbUM7UUFDbkMsZ0JBQWdCLENBQUMsY0FBYyxDQUM3QixHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQy9CLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUNoQix1Q0FBdUMsQ0FDeEMsQ0FBQztRQUVGLHlCQUF5QjtRQUN6QixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDdkUsR0FBRztZQUNILFdBQVcsRUFBRSxzQ0FBc0M7WUFDbkQsZ0JBQWdCLEVBQUUsSUFBSTtTQUN2QixDQUFDLENBQUM7UUFFSCwyQkFBMkI7UUFDM0IsZ0JBQWdCLENBQUMsY0FBYyxDQUM3QixnQkFBZ0IsRUFDaEIsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQ2hCLHFCQUFxQixDQUN0QixDQUFDO1FBRUYsNENBQTRDO1FBQzVDLCtCQUErQjtRQUMvQiw0Q0FBNEM7UUFDNUMsTUFBTSxHQUFHLEdBQUcsSUFBSSxLQUFLLENBQUMsdUJBQXVCLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUN6RCxHQUFHO1lBQ0gsY0FBYyxFQUFFLEtBQUssRUFBRSw0Q0FBNEM7WUFDbkUsYUFBYSxFQUFFLGdCQUFnQjtTQUNoQyxDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsTUFBTSxXQUFXLEdBQUcsSUFBSSxLQUFLLENBQUMsc0JBQXNCLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN4RSxHQUFHO1lBQ0gsSUFBSSxFQUFFLEVBQUU7WUFDUixRQUFRLEVBQUUsS0FBSyxDQUFDLG1CQUFtQixDQUFDLElBQUk7WUFDeEMsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFLHdCQUF3QjtZQUN6RCxXQUFXLEVBQUU7Z0JBQ1gsSUFBSSxFQUFFLEdBQUc7Z0JBQ1QsUUFBUSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDbEMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDaEMscUJBQXFCLEVBQUUsQ0FBQztnQkFDeEIsdUJBQXVCLEVBQUUsQ0FBQzthQUMzQjtZQUNELG1CQUFtQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztTQUM5QyxDQUFDLENBQUM7UUFFSCxXQUFXO1FBQ1gsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxjQUFjLEVBQUU7WUFDL0MsSUFBSSxFQUFFLEVBQUU7WUFDUixRQUFRLEVBQUUsS0FBSyxDQUFDLG1CQUFtQixDQUFDLElBQUk7WUFDeEMsYUFBYSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUM7U0FDM0QsQ0FBQyxDQUFDO1FBRUgsNENBQTRDO1FBQzVDLGlCQUFpQjtRQUNqQiw0Q0FBNEM7UUFDNUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDL0MsR0FBRztZQUNILFdBQVcsRUFBRSw2QkFBNkI7WUFDMUMsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLG9DQUFvQztTQUM5RCxDQUFDLENBQUM7UUFFSCw0Q0FBNEM7UUFDNUMsb0JBQW9CO1FBQ3BCLDRDQUE0QztRQUM1QyxnQ0FBZ0M7UUFDaEMsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN2RSxTQUFTLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDO1lBQzVDLFFBQVEsRUFBRSxVQUFVLENBQUMsUUFBUSxDQUFDLFdBQVc7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsNENBQTRDO1FBQzVDLHlCQUF5QjtRQUN6Qiw0Q0FBNEM7UUFDNUMsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMscUJBQXFCLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzNFLGNBQWMsRUFBRSxHQUFHLEVBQUcsYUFBYTtZQUNuQyxHQUFHLEVBQUUsR0FBRyxFQUFlLGlCQUFpQjtZQUN4QyxlQUFlLEVBQUU7Z0JBQ2YsZUFBZSxFQUFFLEdBQUcsQ0FBQyxlQUFlLENBQUMsTUFBTTtnQkFDM0MscUJBQXFCLEVBQUUsR0FBRyxDQUFDLHFCQUFxQixDQUFDLEtBQUs7YUFDdkQ7U0FDRixDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsTUFBTSxTQUFTLEdBQUcsY0FBYyxDQUFDLFlBQVksQ0FBQyxpQkFBaUIsRUFBRTtZQUMvRCxLQUFLLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxXQUFXLENBQUM7WUFDM0QsT0FBTyxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO2dCQUM5QixZQUFZLEVBQUUsUUFBUTtnQkFDdEIsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTthQUMxQyxDQUFDO1lBQ0YsWUFBWSxFQUFFO2dCQUNaO29CQUNFLGFBQWEsRUFBRSxFQUFFO29CQUNqQixRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHO2lCQUMzQjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsNENBQTRDO1FBQzVDLGlCQUFpQjtRQUNqQiw0Q0FBNEM7UUFDNUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDdEQsT0FBTztZQUNQLGNBQWM7WUFDZCxZQUFZLEVBQUUsQ0FBQyxFQUFFLFlBQVk7WUFDN0IsY0FBYyxFQUFFLEtBQUssRUFBRSxpQkFBaUI7WUFDeEMsVUFBVSxFQUFFO2dCQUNWLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjthQUMvQztZQUNELGNBQWMsRUFBRSxDQUFDLGdCQUFnQixDQUFDO1lBQ2xDLFdBQVcsRUFBRSxnQ0FBZ0M7WUFDN0Msc0JBQXNCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1NBQ2pELENBQUMsQ0FBQztRQUVILDJCQUEyQjtRQUMzQixPQUFPLENBQUMsOEJBQThCLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFcEQsaUJBQWlCO1FBQ2pCLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQztZQUN6QyxXQUFXLEVBQUUsQ0FBQyxFQUFHLFNBQVM7WUFDMUIsV0FBVyxFQUFFLENBQUMsRUFBRyxTQUFTO1NBQzNCLENBQUMsQ0FBQztRQUVILG1CQUFtQjtRQUNuQixPQUFPLENBQUMscUJBQXFCLENBQUMsWUFBWSxFQUFFO1lBQzFDLHdCQUF3QixFQUFFLEVBQUU7WUFDNUIsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUN6QyxnQkFBZ0IsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsbUJBQW1CO1FBQ25CLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxlQUFlLEVBQUU7WUFDaEQsd0JBQXdCLEVBQUUsRUFBRTtZQUM1QixlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3pDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztTQUMzQyxDQUFDLENBQUM7UUFFSCw0Q0FBNEM7UUFDNUMsMkNBQTJDO1FBQzNDLDRDQUE0QztRQUM1QyxNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzdELFlBQVksRUFBRSx5QkFBeUI7WUFDdkMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtZQUN0QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILDRDQUE0QztRQUM1QywwREFBMEQ7UUFDMUQsNENBQTRDO1FBQzVDLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLDhCQUE4QixDQUMxRCxJQUFJLEVBQ0osZUFBZSxFQUNmO1lBQ0UsbUJBQW1CLEVBQUUsbUJBQW1CO1lBQ3hDLGlCQUFpQixFQUFFLE1BQU07WUFDekIscUJBQXFCLEVBQUUscUJBQXFCO1lBQzVDLFdBQVcsRUFBRSw0Q0FBNEM7U0FDMUQsQ0FDRixDQUFDO1FBRUYsNENBQTRDO1FBQzVDLCtCQUErQjtRQUMvQiw0Q0FBNEM7UUFDNUMsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyx5QkFBeUIsQ0FDOUQsSUFBSSxFQUNKLHdCQUF3QixFQUN4QjtZQUNFLFdBQVcsRUFBRSx5REFBeUQ7WUFDdEUsOEJBQThCLEVBQUUsQ0FBQyxhQUFhLENBQUMsaUNBQWlDLENBQUM7WUFDakYscUJBQXFCLEVBQUU7Z0JBQ3JCLGNBQWMsRUFBRTtvQkFDZCxPQUFPLEVBQUUsSUFBSTtvQkFDYixRQUFRLEVBQUUsUUFBUSxDQUFDLFlBQVk7aUJBQ2hDO2FBQ0Y7U0FDRixDQUNGLENBQUM7UUFDRixzQkFBc0IsQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFcEQsNENBQTRDO1FBQzVDLDZDQUE2QztRQUM3Qyw0Q0FBNEM7UUFDNUMsZUFBZTtRQUNmLDRCQUE0QjtRQUM1Qiw2QkFBNkI7UUFDN0Isb0NBQW9DO1FBQ3BDLHlCQUF5QjtRQUN6QixHQUFHO1FBQ0gsTUFBTTtRQUNOLGtHQUFrRztRQUNsRyxpSUFBaUk7UUFDakksaUdBQWlHO1FBRWpHLE1BQU0sbUJBQW1CLEdBQUcsbUJBQW1CLENBQUM7UUFFaEQsa0JBQWtCO1FBQ2xCLE1BQU0sbUJBQW1CLEdBQUcsV0FBVyxtQkFBbUIsZ0JBQWdCLEtBQUssQ0FBQyxZQUFZLEdBQUcsQ0FBQztRQUVoRyxrQkFBa0I7UUFDbEIsTUFBTSxnQkFBZ0IsR0FBRyxXQUFXLG1CQUFtQixnQkFBZ0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxDQUFDO1FBRTFGLGdCQUFnQjtRQUNoQixxQkFBcUI7UUFDckIscURBQXFEO1FBQ3JELE1BQU0sV0FBVyxHQUFhLEVBQUUsQ0FBQztRQUVqQyxpQ0FBaUM7UUFDakMsV0FBVyxDQUFDLElBQUksQ0FDZDs7S0FFRCxtQkFBbUI7R0FDckIsQ0FDRSxDQUFDO1FBRUYsbUNBQW1DO1FBQ25DLHVEQUF1RDtRQUN2RCxXQUFXLENBQUMsSUFBSSxDQUNkOzs7S0FHRCxnQkFBZ0I7R0FDbEIsQ0FDRSxDQUFDO1FBRUYsNkNBQTZDO1FBQzdDLFdBQVcsQ0FBQyxJQUFJLENBQ2Q7O0tBRUQsbUJBQW1CO0tBQ25CLGdCQUFnQjtHQUNsQixDQUNFLENBQUM7UUFFRiwyQkFBMkI7UUFDM0IseUNBQXlDO1FBQ3pDLFdBQVcsQ0FBQyxJQUFJLENBQ2Q7Ozs7R0FJSCxDQUNFLENBQUM7UUFFRix5QkFBeUI7UUFDekIsc0NBQXNDO1FBQ3RDLE1BQU0sY0FBYyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFaEQsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxzQkFBc0IsQ0FDeEQsSUFBSSxFQUNKLHFCQUFxQixFQUNyQjtZQUNFLHdCQUF3QixFQUFFLHNCQUFzQixDQUFDLDRCQUE0QjtZQUM3RSxXQUFXLEVBQUUsc0RBQXNEO1lBQ25FLGNBQWMsRUFBRSxjQUFjO1lBQzlCLGFBQWEsRUFBRSxJQUFJO1NBQ3BCLENBQ0YsQ0FBQztRQUVGLG1CQUFtQixDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUNqRCxtQkFBbUIsQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUUxRCw0Q0FBNEM7UUFDNUMsdUNBQXVDO1FBQ3ZDLDRDQUE0QztRQUM1QyxNQUFNLG9CQUFvQixHQUFHLHFCQUFxQixDQUFDO1FBRW5ELE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLHlCQUF5QixDQUNoRCxJQUFJLEVBQ0osZUFBZSxFQUNmO1lBQ0Usb0JBQW9CLEVBQUUsb0JBQW9CO1lBQzFDLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxpQkFBaUI7WUFDMUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLG9CQUFvQjtZQUNoRCxjQUFjLEVBQUUsS0FBSztZQUNyQixZQUFZLEVBQUUsZUFBZTtZQUM3QixnQkFBZ0IsRUFBRSxDQUFDLGdCQUFnQixDQUFDLGVBQWUsQ0FBQztZQUNwRCxtQkFBbUIsRUFBRTtnQkFDbkIsZUFBZSxFQUFFLEdBQUcsQ0FBQyxlQUFlO2dCQUNwQyxJQUFJLEVBQUUsRUFBRTtnQkFDUixRQUFRLEVBQUUsTUFBTTtnQkFDaEIsU0FBUyxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQzthQUM3RDtZQUNELHFCQUFxQixFQUFFLG1CQUFtQixDQUFDLHlCQUF5QjtZQUNwRSxXQUFXLEVBQUUsd0RBQXdEO1NBQ3RFLENBQ0YsQ0FBQztRQUVGLFFBQVEsQ0FBQyxVQUFVLENBQUMsU0FBUyxHQUFHLHlCQUF5QixDQUFDO1FBQzFELFFBQVEsQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUM1QyxRQUFRLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsWUFBK0IsQ0FBQyxDQUFDO1FBRWpFLDRDQUE0QztRQUM1QyxTQUFTO1FBQ1QsNENBQTRDO1FBQzVDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFO1lBQy9CLEtBQUssRUFBRSxHQUFHLENBQUMsS0FBSztZQUNoQixXQUFXLEVBQUUsUUFBUTtTQUN0QixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyQyxLQUFLLEVBQUUsT0FBTyxDQUFDLFdBQVc7WUFDMUIsV0FBVyxFQUFFLGtCQUFrQjtTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyQyxLQUFLLEVBQUUsT0FBTyxDQUFDLFdBQVc7WUFDMUIsV0FBVyxFQUFFLGtCQUFrQjtTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsR0FBRyxDQUFDLG1CQUFtQjtZQUM5QixXQUFXLEVBQUUsY0FBYztTQUM1QixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxXQUFXLENBQUMsY0FBYztZQUNqQyxXQUFXLEVBQUUsa0JBQWtCO1NBQ2hDLENBQUMsQ0FBQztRQUVILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUM3RSxLQUFLLEVBQUUsV0FBVyxLQUFLLENBQUMsaUJBQWlCLEVBQUU7WUFDM0MsV0FBVyxFQUFFLGlEQUFpRDtTQUMvRCxDQUFDLENBQUM7UUFDSCxpQkFBaUIsQ0FBQyxTQUFTLEdBQUcseUJBQXlCLENBQUM7UUFFeEQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUsc0JBQXNCLENBQUMsNEJBQTRCO1lBQzFELFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxZQUFZO1lBQzVCLFdBQVcsRUFBRSw0QkFBNEI7U0FDMUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBcllELDhEQXFZQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVsYnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZWNyX2Fzc2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFZlcmlmaWVkQWNjZXNzRWNzU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqXG4gICAqIOeuoeeQhuiAheOCsOODq+ODvOODl0lEXG4gICAqIElBTSBJZGVudGl0eSBDZW50ZXLjga7jgrDjg6vjg7zjg5dJROOCkuaMh+WumlxuICAgKiAvYWRtaW4vKiDjgaggL2hyLWFkbWluLyog44Gr44Ki44Kv44K744K55Y+v6IO9XG4gICAqIOS+izogJ2ctMTIzNDU2Nzg5MGFiY2RlZidcbiAgICovXG4gIGFkbWluR3JvdXBJZDogc3RyaW5nO1xuICBcbiAgLyoqXG4gICAqIOS6uuS6i+mDqOOCsOODq+ODvOODl0lEXG4gICAqIElBTSBJZGVudGl0eSBDZW50ZXLjga7jgrDjg6vjg7zjg5dJROOCkuaMh+WumlxuICAgKiAvaHIvKiDjgaggL2hyLWFkbWluLyog44Gr44Ki44Kv44K744K55Y+v6IO9XG4gICAqIOS+izogJ2U3MjRlYTY4LTEwNTEtNzAyNi1iNThmLTYyZDcwZGJhYTM3MSdcbiAgICovXG4gIGhyR3JvdXBJZDogc3RyaW5nO1xuICBcbiAgLyoqXG4gICAqIOOCouODl+ODquOCseODvOOCt+ODp+ODs+ODieODoeOCpOODs+WQje+8iFZlcmlmaWVkIEFjY2VzcyBFbmRwb2ludOeUqO+8iVxuICAgKiDkvos6ICd2ZXJpZmllZC1hY2Nlc3MtZWNzLmV4YW1wbGUuY29tJ1xuICAgKi9cbiAgYXBwbGljYXRpb25Eb21haW46IHN0cmluZztcbiAgXG4gIC8qKlxuICAgKiBBQ03oqLzmmI7mm7jjga5BUk7vvIhWZXJpZmllZCBBY2Nlc3MgRW5kcG9pbnTnlKjvvIlcbiAgICog5L6LOiAnYXJuOmF3czphY206YXAtbm9ydGhlYXN0LTE6MTIzNDU2Nzg5MDEyOmNlcnRpZmljYXRlL2FiYzEyMy4uLidcbiAgICovXG4gIGRvbWFpbkNlcnRpZmljYXRlQXJuOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDZGtWZXJpZmllZEFjY2Vzc0Vjc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFZlcmlmaWVkQWNjZXNzRWNzU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyAwLiDjg4fjg5fjg63jgqTmnaHku7bjga7oqK3lrppcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIOWIneWbnuODh+ODl+ODreOCpOOBi+OBqeOBhuOBi+OCkuWIpOWumuOBmeOCi+ODkeODqeODoeODvOOCv1xuICAgIGNvbnN0IGlzRmlyc3REZXBsb3kgPSBuZXcgY2RrLkNmblBhcmFtZXRlcih0aGlzLCAnSXNGaXJzdERlcGxveScsIHtcbiAgICAgIHR5cGU6ICdTdHJpbmcnLFxuICAgICAgZGVmYXVsdDogJ3RydWUnLFxuICAgICAgYWxsb3dlZFZhbHVlczogWyd0cnVlJywgJ2ZhbHNlJ10sXG4gICAgICBkZXNjcmlwdGlvbjogJ+WIneWbnuODh+ODl+ODreOCpOOBruWgtOWQiOOBr3RydWXjgIEy5Zue55uu5Lul6ZmN44GvZmFsc2UnLFxuICAgIH0pO1xuXG4gICAgLy8g5p2h5Lu244Gu5L2c5oiQXG4gICAgY29uc3QgaXNGaXJzdERlcGxveUNvbmRpdGlvbiA9IG5ldyBjZGsuQ2ZuQ29uZGl0aW9uKHRoaXMsICdJc0ZpcnN0RGVwbG95Q29uZGl0aW9uJywge1xuICAgICAgZXhwcmVzc2lvbjogY2RrLkZuLmNvbmRpdGlvbkVxdWFscyhpc0ZpcnN0RGVwbG95LnZhbHVlQXNTdHJpbmcsICd0cnVlJyksXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgaXNOb3RGaXJzdERlcGxveUNvbmRpdGlvbiA9IG5ldyBjZGsuQ2ZuQ29uZGl0aW9uKHRoaXMsICdJc05vdEZpcnN0RGVwbG95Q29uZGl0aW9uJywge1xuICAgICAgZXhwcmVzc2lvbjogY2RrLkZuLmNvbmRpdGlvbk5vdChpc0ZpcnN0RGVwbG95Q29uZGl0aW9uKSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMS4gVlBD5L2c5oiQXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnVnBjJywge1xuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsIC8vIEVDUyBGYXJnYXRl44Gv5aSW6YOo6YCa5L+h44GM5b+F6KaB44Gq44Gu44GnTkFUIEdhdGV3YXnov73liqBcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAnUHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyAyLiDjgrvjgq3jg6Xjg6rjg4bjgqPjgrDjg6vjg7zjg5dcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFMQueUqOOCu+OCreODpeODquODhuOCo+OCsOODq+ODvOODl1xuICAgIGNvbnN0IGFsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FsYlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBBTEInLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFZlcmlmaWVkIEFjY2Vzc+OBi+OCiUFMQuOBuOOBrkhUVFDjgqLjgq/jgrvjgrnoqLHlj69cbiAgICBhbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuaXB2NCh2cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg4MCksXG4gICAgICAnQWxsb3cgSFRUUCBmcm9tIFZQQyAoVmVyaWZpZWQgQWNjZXNzKSdcbiAgICApO1xuXG4gICAgLy8gRUNTIEZhcmdhdGXnlKjjgrvjgq3jg6Xjg6rjg4bjgqPjgrDjg6vjg7zjg5dcbiAgICBjb25zdCBlY3NTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdFY3NTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgRUNTIEZhcmdhdGUgdGFza3MnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFMQuOBi+OCiUVDUyBGYXJnYXRl44G444Gu44Ki44Kv44K744K56Kix5Y+vXG4gICAgZWNzU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGFsYlNlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoODApLFxuICAgICAgJ0FsbG93IEhUVFAgZnJvbSBBTEInXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMy4gQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlclxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYWxiID0gbmV3IGVsYnYyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyKHRoaXMsICdBbGInLCB7XG4gICAgICB2cGMsXG4gICAgICBpbnRlcm5ldEZhY2luZzogZmFsc2UsIC8vIFZlcmlmaWVkIEFjY2VzcyBFbmRwb2ludOOBq+OBr0ludGVybmFsIEFMQuOBjOW/heimgVxuICAgICAgc2VjdXJpdHlHcm91cDogYWxiU2VjdXJpdHlHcm91cCxcbiAgICB9KTtcblxuICAgIC8vIOOCv+ODvOOCsuODg+ODiOOCsOODq+ODvOODl++8iEVDUyBGYXJnYXRl55So77yJXG4gICAgY29uc3QgdGFyZ2V0R3JvdXAgPSBuZXcgZWxidjIuQXBwbGljYXRpb25UYXJnZXRHcm91cCh0aGlzLCAnVGFyZ2V0R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBwb3J0OiA4MCxcbiAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICB0YXJnZXRUeXBlOiBlbGJ2Mi5UYXJnZXRUeXBlLklQLCAvLyBGYXJnYXRl44Gu5aC05ZCI44GvSVDjgr/jg7zjgrLjg4Pjg4jjgr/jgqTjg5dcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIHBhdGg6ICcvJyxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgICB9LFxuICAgICAgZGVyZWdpc3RyYXRpb25EZWxheTogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgIH0pO1xuXG4gICAgLy8gSFRUUOODquOCueODiuODvFxuICAgIGNvbnN0IGxpc3RlbmVyID0gYWxiLmFkZExpc3RlbmVyKCdIdHRwTGlzdGVuZXInLCB7XG4gICAgICBwb3J0OiA4MCxcbiAgICAgIHByb3RvY29sOiBlbGJ2Mi5BcHBsaWNhdGlvblByb3RvY29sLkhUVFAsXG4gICAgICBkZWZhdWx0QWN0aW9uOiBlbGJ2Mi5MaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFt0YXJnZXRHcm91cF0pLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyA0LiBFQ1MgQ2x1c3RlclxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGNsdXN0ZXJOYW1lOiAndmVyaWZpZWQtYWNjZXNzLWVjcy1jbHVzdGVyJyxcbiAgICAgIGNvbnRhaW5lckluc2lnaHRzOiB0cnVlLCAvLyBDbG91ZFdhdGNoIENvbnRhaW5lciBJbnNpZ2h0c+OCkuacieWKueWMllxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyA1LiBEb2NrZXLjgqTjg6Hjg7zjgrjjga7jg5Pjg6vjg4lcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERvY2tlcmZpbGXjgYzjgYLjgovjg4fjgqPjg6zjgq/jg4jjg6rjgYvjgonjgqTjg6Hjg7zjgrjjgpLjg5Pjg6vjg4lcbiAgICBjb25zdCBkb2NrZXJJbWFnZSA9IG5ldyBlY3JfYXNzZXRzLkRvY2tlckltYWdlQXNzZXQodGhpcywgJ1dlYkFwcEltYWdlJywge1xuICAgICAgZGlyZWN0b3J5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vZG9ja2VyJyksXG4gICAgICBwbGF0Zm9ybTogZWNyX2Fzc2V0cy5QbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gNi4gRUNTIFRhc2sgRGVmaW5pdGlvblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgdGFza0RlZmluaXRpb24gPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCAnVGFza0RlZmluaXRpb24nLCB7XG4gICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLCAgLy8g44Oh44Oi44OqOiA1MTJNQlxuICAgICAgY3B1OiAyNTYsICAgICAgICAgICAgICAvLyBDUFU6IDAuMjUgdkNQVVxuICAgICAgcnVudGltZVBsYXRmb3JtOiB7XG4gICAgICAgIGNwdUFyY2hpdGVjdHVyZTogZWNzLkNwdUFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICAgIG9wZXJhdGluZ1N5c3RlbUZhbWlseTogZWNzLk9wZXJhdGluZ1N5c3RlbUZhbWlseS5MSU5VWCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDjgrPjg7Pjg4bjg4rjga7ov73liqBcbiAgICBjb25zdCBjb250YWluZXIgPSB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ1dlYkFwcENvbnRhaW5lcicsIHtcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckltYWdlQXNzZXQoZG9ja2VySW1hZ2UpLFxuICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgIHN0cmVhbVByZWZpeDogJ3dlYmFwcCcsXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgfSksXG4gICAgICBwb3J0TWFwcGluZ3M6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNvbnRhaW5lclBvcnQ6IDgwLFxuICAgICAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVENQLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gNy4gRUNTIFNlcnZpY2VcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHNlcnZpY2UgPSBuZXcgZWNzLkZhcmdhdGVTZXJ2aWNlKHRoaXMsICdTZXJ2aWNlJywge1xuICAgICAgY2x1c3RlcixcbiAgICAgIHRhc2tEZWZpbml0aW9uLFxuICAgICAgZGVzaXJlZENvdW50OiAyLCAvLyDliJ3mnJ/jgr/jgrnjgq/mlbA6IDJcbiAgICAgIGFzc2lnblB1YmxpY0lwOiBmYWxzZSwgLy8g44OX44Op44Kk44OZ44O844OI44K144OW44ON44OD44OI44Gr6YWN572uXG4gICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICB9LFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtlY3NTZWN1cml0eUdyb3VwXSxcbiAgICAgIHNlcnZpY2VOYW1lOiAndmVyaWZpZWQtYWNjZXNzLXdlYmFwcC1zZXJ2aWNlJyxcbiAgICAgIGhlYWx0aENoZWNrR3JhY2VQZXJpb2Q6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICB9KTtcblxuICAgIC8vIOOCv+ODvOOCsuODg+ODiOOCsOODq+ODvOODl+OBq0VDUyBTZXJ2aWNl44KS55m76YyyXG4gICAgc2VydmljZS5hdHRhY2hUb0FwcGxpY2F0aW9uVGFyZ2V0R3JvdXAodGFyZ2V0R3JvdXApO1xuXG4gICAgLy8gQXV0byBTY2FsaW5n6Kit5a6aXG4gICAgY29uc3Qgc2NhbGluZyA9IHNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiAxLCAgLy8g5pyA5bCP44K/44K544Kv5pWwXG4gICAgICBtYXhDYXBhY2l0eTogNCwgIC8vIOacgOWkp+OCv+OCueOCr+aVsFxuICAgIH0pO1xuXG4gICAgLy8gQ1BV5L2/55So546H44OZ44O844K544Gu44K544Kx44O844Oq44Oz44KwXG4gICAgc2NhbGluZy5zY2FsZU9uQ3B1VXRpbGl6YXRpb24oJ0NwdVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDcwLFxuICAgICAgc2NhbGVJbkNvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBzY2FsZU91dENvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgfSk7XG5cbiAgICAvLyDjg6Hjg6Ljg6rkvb/nlKjnjofjg5njg7zjgrnjga7jgrnjgrHjg7zjg6rjg7PjgrBcbiAgICBzY2FsaW5nLnNjYWxlT25NZW1vcnlVdGlsaXphdGlvbignTWVtb3J5U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogODAsXG4gICAgICBzY2FsZUluQ29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIHNjYWxlT3V0Q29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gOC4gQ2xvdWRXYXRjaCBMb2dz44Kw44Or44O844OX77yIVmVyaWZpZWQgQWNjZXNz55So77yJXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdWZXJpZmllZEFjY2Vzc0xvZ3MnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL3ZlcmlmaWVkYWNjZXNzL2VjcycsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIDkuIFZlcmlmaWVkIEFjY2VzcyBUcnVzdCBQcm92aWRlciAoSUFNIElkZW50aXR5IENlbnRlcilcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHRydXN0UHJvdmlkZXIgPSBuZXcgZWMyLkNmblZlcmlmaWVkQWNjZXNzVHJ1c3RQcm92aWRlcihcbiAgICAgIHRoaXMsXG4gICAgICAnVHJ1c3RQcm92aWRlcicsXG4gICAgICB7XG4gICAgICAgIHBvbGljeVJlZmVyZW5jZU5hbWU6ICdJQU1JZGVudGl0eUNlbnRlcicsXG4gICAgICAgIHRydXN0UHJvdmlkZXJUeXBlOiAndXNlcicsXG4gICAgICAgIHVzZXJUcnVzdFByb3ZpZGVyVHlwZTogJ2lhbS1pZGVudGl0eS1jZW50ZXInLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0lBTSBJZGVudGl0eSBDZW50ZXIgdHJ1c3QgcHJvdmlkZXIgZm9yIEVDUycsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMTAuIFZlcmlmaWVkIEFjY2VzcyBJbnN0YW5jZVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgdmVyaWZpZWRBY2Nlc3NJbnN0YW5jZSA9IG5ldyBlYzIuQ2ZuVmVyaWZpZWRBY2Nlc3NJbnN0YW5jZShcbiAgICAgIHRoaXMsXG4gICAgICAnVmVyaWZpZWRBY2Nlc3NJbnN0YW5jZScsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnVmVyaWZpZWQgQWNjZXNzIGZvciBFQ1MgRmFyZ2F0ZSB3aXRoIHBhdGgtYmFzZWQgY29udHJvbCcsXG4gICAgICAgIHZlcmlmaWVkQWNjZXNzVHJ1c3RQcm92aWRlcklkczogW3RydXN0UHJvdmlkZXIuYXR0clZlcmlmaWVkQWNjZXNzVHJ1c3RQcm92aWRlcklkXSxcbiAgICAgICAgbG9nZ2luZ0NvbmZpZ3VyYXRpb25zOiB7XG4gICAgICAgICAgY2xvdWRXYXRjaExvZ3M6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBsb2dHcm91cDogbG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKTtcbiAgICB2ZXJpZmllZEFjY2Vzc0luc3RhbmNlLmFkZERlcGVuZGVuY3kodHJ1c3RQcm92aWRlcik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIDExLiBWZXJpZmllZCBBY2Nlc3MgR3JvdXDvvIjjg5Hjgrnjg5njg7zjgrnjgqLjgq/jgrvjgrnliLblvqHjg53jg6rjgrfjg7zvvIlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIOOCteODneODvOODiOaDheWgseOCkuWFg+OBq+Wun+ijhTpcbiAgICAvLyAtIC9hZG1pbi8qIOOBuOOBruOCouOCr+OCu+OCueOBr+euoeeQhuiAheOBruOBv+ioseWPr1xuICAgIC8vIC0gL2hyLyog44G444Gu44Ki44Kv44K744K544Gv5Lq65LqL6YOo44Om44O844K244O844Gu44G/6Kix5Y+vXG4gICAgLy8gLSAvaHItYWRtaW4vKiDjgbjjga7jgqLjgq/jgrvjgrnjga/kurrkuovpg6jjgYvjgaTnrqHnkIbogIXjga7jgb/oqLHlj69cbiAgICAvLyAtIOOBneOBruS7luOBruODkeOCueOBr+iqjeiovOa4iOOBv+ODpuODvOOCtuODvOOBr+WFqOOBpuioseWPr1xuICAgIC8vIFxuICAgIC8vIOWPguiAgzpcbiAgICAvLyAtIGxpa2XmvJTnrpflrZA6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS92ZXJpZmllZC1hY2Nlc3MvbGF0ZXN0L3VnL2J1aWx0LWluLXBvbGljeS1vcGVyYXRvcnMuaHRtbFxuICAgIC8vIC0g44Kw44Or44O844OX5oyH5a6aOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vdmVyaWZpZWQtYWNjZXNzL2xhdGVzdC91Zy90cnVzdC1kYXRhLWlhbS1hZGQtcG9sLmh0bWwjZXhhbXBsZS1wb2xpY3ktaWFtLWlkZW50aXR5LWNlbnRlclxuICAgIC8vIC0g44Od44Oq44K344O86KmV5L6hOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vdmVyaWZpZWQtYWNjZXNzL2xhdGVzdC91Zy9hdXRoLXBvbGljaWVzLXBvbGljeS1ldmFsLmh0bWxcbiAgICBcbiAgICBjb25zdCBwb2xpY3lSZWZlcmVuY2VOYW1lID0gJ0lBTUlkZW50aXR5Q2VudGVyJztcbiAgICBcbiAgICAvLyDnrqHnkIbogIXjgrDjg6vjg7zjg5dJROOBruadoeS7tuOCkuani+eviVxuICAgIGNvbnN0IGFkbWluR3JvdXBDb25kaXRpb24gPSBgY29udGV4dC4ke3BvbGljeVJlZmVyZW5jZU5hbWV9Lmdyb3VwcyBoYXMgXCIke3Byb3BzLmFkbWluR3JvdXBJZH1cImA7XG4gICAgXG4gICAgLy8g5Lq65LqL6YOo44Kw44Or44O844OXSUTjga7mnaHku7bjgpLmp4vnr4lcbiAgICBjb25zdCBockdyb3VwQ29uZGl0aW9uID0gYGNvbnRleHQuJHtwb2xpY3lSZWZlcmVuY2VOYW1lfS5ncm91cHMgaGFzIFwiJHtwcm9wcy5ockdyb3VwSWR9XCJgO1xuICAgIFxuICAgIC8vIOODneODquOCt+ODvOODieOCreODpeODoeODs+ODiOOCkuani+eviVxuICAgIC8vIOWLleS9nOeiuuiqjea4iOOBv+OBruODneODquOCt+ODvOOBq+WfuuOBpeOBhOOBpuWun+ijhVxuICAgIC8vIOazqOaEjzogcGF0aCBsaWtlIOOBruODkeOCv+ODvOODs+OBi+OCieacgOWIneOBriBcIi9cIiDjgpLliYrpmaTvvIhcImFkbWluLypcIiDjga7jgojjgYbjgavoqJjov7DvvIlcbiAgICBjb25zdCBwZXJtaXRQYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgICBcbiAgICAvLyAxLiBhZG1pbi8qIOOBuOOBruOCouOCr+OCu+OCuTog566h55CG6ICF44Kw44Or44O844OX44Gu44G/6Kix5Y+vXG4gICAgcGVybWl0UGFydHMucHVzaChcbiAgICAgIGBwZXJtaXQocHJpbmNpcGFsLCBhY3Rpb24sIHJlc291cmNlKSB3aGVuIHtcbiAgY29udGV4dC5odHRwX3JlcXVlc3QucGF0aCBsaWtlIFwiYWRtaW4vKlwiICYmXG4gICgke2FkbWluR3JvdXBDb25kaXRpb259KVxufTtgXG4gICAgKTtcbiAgICBcbiAgICAvLyAyLiBoci8qIOOBuOOBruOCouOCr+OCu+OCuTog5Lq65LqL6YOo44Kw44Or44O844OX44Gu44Om44O844K244O844Gu44G/6Kix5Y+vXG4gICAgLy8g5rOo5oSPOiAvaHItYWRtaW4vKiDjgpLpmaTlpJbjgZnjgovjgZ/jgoHjgIEvaHItYWRtaW4vKiDjga7jg4Hjgqfjg4Pjgq/jga8gXCIvXCIg5LuY44GN44Gn6KiY6L+wXG4gICAgcGVybWl0UGFydHMucHVzaChcbiAgICAgIGBwZXJtaXQocHJpbmNpcGFsLCBhY3Rpb24sIHJlc291cmNlKSB3aGVuIHtcbiAgY29udGV4dC5odHRwX3JlcXVlc3QucGF0aCBsaWtlIFwiaHIvKlwiICYmXG4gICEoY29udGV4dC5odHRwX3JlcXVlc3QucGF0aCBsaWtlIFwiL2hyLWFkbWluLypcIikgJiZcbiAgKCR7aHJHcm91cENvbmRpdGlvbn0pXG59O2BcbiAgICApO1xuICAgIFxuICAgIC8vIDMuIGhyLWFkbWluLyog44G444Gu44Ki44Kv44K744K5OiDkurrkuovpg6jjgrDjg6vjg7zjg5fjgYvjgaTnrqHnkIbogIXjgrDjg6vjg7zjg5fjga7jgb/oqLHlj69cbiAgICBwZXJtaXRQYXJ0cy5wdXNoKFxuICAgICAgYHBlcm1pdChwcmluY2lwYWwsIGFjdGlvbiwgcmVzb3VyY2UpIHdoZW4ge1xuICBjb250ZXh0Lmh0dHBfcmVxdWVzdC5wYXRoIGxpa2UgXCJoci1hZG1pbi8qXCIgJiZcbiAgKCR7YWRtaW5Hcm91cENvbmRpdGlvbn0pICYmXG4gICgke2hyR3JvdXBDb25kaXRpb259KVxufTtgXG4gICAgKTtcbiAgICBcbiAgICAvLyA0LiDjgZ3jga7ku5bjga7jg5Hjgrk6IOiqjeiovOa4iOOBv+ODpuODvOOCtuODvOOBr+WFqOOBpuioseWPr1xuICAgIC8vIGFkbWluLyosIGhyLyosIGhyLWFkbWluLyog5Lul5aSW44Gu44GZ44G544Gm44Gu44OR44K544KS6Kix5Y+vXG4gICAgcGVybWl0UGFydHMucHVzaChcbiAgICAgIGBwZXJtaXQocHJpbmNpcGFsLCBhY3Rpb24sIHJlc291cmNlKSB3aGVuIHtcbiAgIShjb250ZXh0Lmh0dHBfcmVxdWVzdC5wYXRoIGxpa2UgXCJhZG1pbi8qXCIpICYmXG4gICEoY29udGV4dC5odHRwX3JlcXVlc3QucGF0aCBsaWtlIFwiaHIvKlwiKSAmJlxuICAhKGNvbnRleHQuaHR0cF9yZXF1ZXN0LnBhdGggbGlrZSBcImhyLWFkbWluLypcIilcbn07YFxuICAgICk7XG4gICAgXG4gICAgLy8gcGVybWl044Gu44G/44KS5L2/55So77yIZm9yYmlk44Gv5YmK6Zmk77yJXG4gICAgLy8gQ2VkYXLjga7oqZXkvqHjg6vjg7zjg6s6IOWwkeOBquOBj+OBqOOCgjHjgaTjga5wZXJtaXTjgYzlkIjoh7TjgZnjgozjgbDoqLHlj69cbiAgICBjb25zdCBwb2xpY3lEb2N1bWVudCA9IHBlcm1pdFBhcnRzLmpvaW4oJ1xcblxcbicpO1xuXG4gICAgY29uc3QgdmVyaWZpZWRBY2Nlc3NHcm91cCA9IG5ldyBlYzIuQ2ZuVmVyaWZpZWRBY2Nlc3NHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICAnVmVyaWZpZWRBY2Nlc3NHcm91cCcsXG4gICAgICB7XG4gICAgICAgIHZlcmlmaWVkQWNjZXNzSW5zdGFuY2VJZDogdmVyaWZpZWRBY2Nlc3NJbnN0YW5jZS5hdHRyVmVyaWZpZWRBY2Nlc3NJbnN0YW5jZUlkLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0dyb3VwIGZvciBFQ1MgRmFyZ2F0ZSB3aXRoIHBhdGgtYmFzZWQgYWNjZXNzIGNvbnRyb2wnLFxuICAgICAgICBwb2xpY3lEb2N1bWVudDogcG9saWN5RG9jdW1lbnQsXG4gICAgICAgIHBvbGljeUVuYWJsZWQ6IHRydWUsXG4gICAgICB9XG4gICAgKTtcblxuICAgIHZlcmlmaWVkQWNjZXNzR3JvdXAuYWRkRGVwZW5kZW5jeSh0cnVzdFByb3ZpZGVyKTtcbiAgICB2ZXJpZmllZEFjY2Vzc0dyb3VwLmFkZERlcGVuZGVuY3kodmVyaWZpZWRBY2Nlc3NJbnN0YW5jZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIDEyLiBWZXJpZmllZCBBY2Nlc3MgRW5kcG9pbnQgKEhUVFBTKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgZW5kcG9pbnREb21haW5QcmVmaXggPSAndmVyaWZpZWQtYWNjZXNzLWVjcyc7XG4gICAgXG4gICAgY29uc3QgZW5kcG9pbnQgPSBuZXcgZWMyLkNmblZlcmlmaWVkQWNjZXNzRW5kcG9pbnQoXG4gICAgICB0aGlzLFxuICAgICAgJ0h0dHBzRW5kcG9pbnQnLFxuICAgICAge1xuICAgICAgICBlbmRwb2ludERvbWFpblByZWZpeDogZW5kcG9pbnREb21haW5QcmVmaXgsXG4gICAgICAgIGFwcGxpY2F0aW9uRG9tYWluOiBwcm9wcy5hcHBsaWNhdGlvbkRvbWFpbixcbiAgICAgICAgZG9tYWluQ2VydGlmaWNhdGVBcm46IHByb3BzLmRvbWFpbkNlcnRpZmljYXRlQXJuLFxuICAgICAgICBhdHRhY2htZW50VHlwZTogJ3ZwYycsXG4gICAgICAgIGVuZHBvaW50VHlwZTogJ2xvYWQtYmFsYW5jZXInLFxuICAgICAgICBzZWN1cml0eUdyb3VwSWRzOiBbYWxiU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgICBsb2FkQmFsYW5jZXJPcHRpb25zOiB7XG4gICAgICAgICAgbG9hZEJhbGFuY2VyQXJuOiBhbGIubG9hZEJhbGFuY2VyQXJuLFxuICAgICAgICAgIHBvcnQ6IDgwLFxuICAgICAgICAgIHByb3RvY29sOiAnaHR0cCcsXG4gICAgICAgICAgc3VibmV0SWRzOiB2cGMucHJpdmF0ZVN1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLFxuICAgICAgICB9LFxuICAgICAgICB2ZXJpZmllZEFjY2Vzc0dyb3VwSWQ6IHZlcmlmaWVkQWNjZXNzR3JvdXAuYXR0clZlcmlmaWVkQWNjZXNzR3JvdXBJZCxcbiAgICAgICAgZGVzY3JpcHRpb246ICdIVFRQUyBlbmRwb2ludCBmb3IgRUNTIEZhcmdhdGUgd2l0aCBwYXRoLWJhc2VkIGNvbnRyb2wnLFxuICAgICAgfVxuICAgICk7XG5cbiAgICBlbmRwb2ludC5jZm5PcHRpb25zLmNvbmRpdGlvbiA9IGlzTm90Rmlyc3REZXBsb3lDb25kaXRpb247XG4gICAgZW5kcG9pbnQuYWRkRGVwZW5kZW5jeSh2ZXJpZmllZEFjY2Vzc0dyb3VwKTtcbiAgICBlbmRwb2ludC5hZGREZXBlbmRlbmN5KGFsYi5ub2RlLmRlZmF1bHRDaGlsZCBhcyBjZGsuQ2ZuUmVzb3VyY2UpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyAxMy4g5Ye65YqbXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XG4gICAgICB2YWx1ZTogdnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgSUQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NsdXN0ZXJOYW1lJywge1xuICAgICAgdmFsdWU6IGNsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBDbHVzdGVyIE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NlcnZpY2VOYW1lJywge1xuICAgICAgdmFsdWU6IHNlcnZpY2Uuc2VydmljZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBTZXJ2aWNlIE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FsYkRuc05hbWUnLCB7XG4gICAgICB2YWx1ZTogYWxiLmxvYWRCYWxhbmNlckRuc05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FMQiBETlMgTmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVGFyZ2V0R3JvdXBBcm4nLCB7XG4gICAgICB2YWx1ZTogdGFyZ2V0R3JvdXAudGFyZ2V0R3JvdXBBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1RhcmdldCBHcm91cCBBUk4nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZW5kcG9pbnRVcmxPdXRwdXQgPSBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVmVyaWZpZWRBY2Nlc3NFbmRwb2ludFVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3Byb3BzLmFwcGxpY2F0aW9uRG9tYWlufWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZlcmlmaWVkIEFjY2VzcyBFbmRwb2ludCBVUkwgKEhUVFBTKSAtIOOCq+OCueOCv+ODoOODieODoeOCpOODsycsXG4gICAgfSk7XG4gICAgZW5kcG9pbnRVcmxPdXRwdXQuY29uZGl0aW9uID0gaXNOb3RGaXJzdERlcGxveUNvbmRpdGlvbjtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWZXJpZmllZEFjY2Vzc0luc3RhbmNlSWQnLCB7XG4gICAgICB2YWx1ZTogdmVyaWZpZWRBY2Nlc3NJbnN0YW5jZS5hdHRyVmVyaWZpZWRBY2Nlc3NJbnN0YW5jZUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdWZXJpZmllZCBBY2Nlc3MgSW5zdGFuY2UgSUQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiBsb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9ncyBHcm91cCBOYW1lJyxcbiAgICB9KTtcbiAgfVxufVxuXG4iXX0=