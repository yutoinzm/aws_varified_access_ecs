# 詳細デプロイガイド

> AWS Verified Access + ECS Fargateの詳細なデプロイ手順

---

## 📋 目次

1. [前提条件の準備](#前提条件の準備)
2. [ACM証明書の作成](#acm証明書の作成)
3. [IAM Identity Centerの設定](#iam-identity-centerの設定)
4. [CDKプロジェクトの準備](#cdkプロジェクトの準備)
5. [初回デプロイ](#初回デプロイ)
6. [2回目のデプロイ](#2回目のデプロイ)
7. [DNS設定](#dns設定)
8. [動作確認](#動作確認)
9. [トラブルシューティング](#トラブルシューティング)

---

## 前提条件の準備

### 1. AWS CLIのインストールと設定

```bash
# AWS CLIのバージョン確認
aws --version

# プロファイルの設定
aws configure --profile your-profile

# 認証情報の確認
aws sts get-caller-identity --profile your-profile
```

### 2. AWS CDK v2のインストール

```bash
# CDKのインストール
npm install -g aws-cdk

# バージョン確認（2.0以上であること）
cdk --version
```

### 3. Node.jsのバージョン確認

```bash
# Node.jsのバージョン確認（18以上推奨）
node --version

# npmのバージョン確認
npm --version
```

---

## ACM証明書の作成

Verified Accessエンドポイントには、**ap-northeast-1リージョン**のACM証明書が必要です。

### 方法1: AWS Management Console

1. **ACMコンソールを開く**
   - リージョンを**ap-northeast-1（東京）**に設定
   - 「証明書をリクエスト」をクリック

2. **証明書タイプの選択**
   - 「パブリック証明書をリクエスト」を選択

3. **ドメイン名の入力**
   - 完全修飾ドメイン名: `verified-access-ecs.example.com`
   - または、ワイルドカード: `*.example.com`

4. **検証方法の選択**
   - **DNS検証**（推奨）または **Eメール検証**

5. **DNSレコードの追加**（DNS検証の場合）
   - CNAMEレコードをRoute 53または外部DNSに追加
   - 検証には5-30分程度かかる場合があります

6. **証明書ARNの取得**
   - 発行後、証明書ARNをコピー
   - 例: `arn:aws:acm:ap-northeast-1:123456789012:certificate/xxxxx`

### 方法2: AWS CLI

```bash
# 証明書のリクエスト
aws acm request-certificate \
  --domain-name verified-access-ecs.example.com \
  --validation-method DNS \
  --region ap-northeast-1

# 証明書の検証情報取得
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:ap-northeast-1:xxxxx:certificate/xxxxx \
  --region ap-northeast-1

# 検証状態の確認
aws acm list-certificates \
  --region ap-northeast-1 \
  --query 'CertificateSummaryList[?DomainName==`verified-access-ecs.example.com`]'
```

---

## IAM Identity Centerの設定

### ステップ1: IAM Identity Centerの有効化

1. AWS Management Console → IAM Identity Center
2. 「有効化」をクリック（初回のみ）
3. リージョンを選択（通常は us-east-1）

### ステップ2: グループの作成

1. IAM Identity Center → 「グループ」→ 「グループを作成」
2. **管理者グループ**を作成:
   - **グループ名**: `Admin` または任意の名前
   - **説明**: `管理者権限を持つユーザーのグループ`
3. **人事部グループ**を作成:
   - **グループ名**: `HR` または任意の名前
   - **説明**: `人事部のユーザーのグループ`

### ステップ3: グループIDの取得

グループIDは、Cedarポリシーで使用するために必要です。

#### AWS Management Consoleでの取得

1. IAM Identity Center → 「グループ」
2. 対象グループを選択
3. グループの詳細ページで**グループID**をコピー
   - 例: `f79d6ad8-1da1-7b36-4ad3-53dad7cc2iff`

#### AWS CLIでの取得

```bash
# Identity Store IDの取得
IDENTITY_STORE_ID=$(aws sso-admin list-instances --query 'Instances[0].IdentityStoreId' --output text)

# 管理者グループIDの取得
ADMIN_GROUP_ID=$(aws identitystore list-groups \
  --identity-store-id $IDENTITY_STORE_ID \
  --filters AttributePath=DisplayName,AttributeValue=Admin \
  --query 'Groups[0].GroupId' --output text)

# 人事部グループIDの取得
HR_GROUP_ID=$(aws identitystore list-groups \
  --identity-store-id $IDENTITY_STORE_ID \
  --filters AttributePath=DisplayName,AttributeValue=HR \
  --query 'Groups[0].GroupId' --output text)

echo "管理者グループID: $ADMIN_GROUP_ID"
echo "人事部グループID: $HR_GROUP_ID"
```

### ステップ4: ユーザーをグループに追加

1. IAM Identity Center → 「グループ」→ 対象グループを選択
2. 「ユーザー」タブ → 「ユーザーを追加」
3. ユーザーを選択して追加

---

## CDKプロジェクトの準備

### ステップ1: リポジトリのクローン

```bash
git clone <repository-url>
cd cdk-verified-access-ecs
```

### ステップ2: 依存関係のインストール

```bash
npm install
```

### ステップ3: 環境変数の設定

`.env`ファイルを作成する方法（推奨）:

```bash
# .env.exampleをコピー
cp .env.example .env

# .envファイルを編集
vim .env
```

**.envファイルの内容:**
```bash
# 必須項目
ADMIN_GROUP_ID=管理者グループID
HR_GROUP_ID=人事部グループID
APPLICATION_DOMAIN=verified-access-ecs.example.com
DOMAIN_CERTIFICATE_ARN=arn:aws:acm:ap-northeast-1:123456789012:certificate/xxxxx
SKIP_BOOTSTRAP=yes
CDK_DOCKER=podman  # または docker

# オプション項目
AWS_PROFILE=your-profile
AWS_REGION=ap-northeast-1
```

または、環境変数を直接設定:

```bash
# AWSプロファイル
export AWS_PROFILE=your-profile

# IAM Identity CenterのグループID
export ADMIN_GROUP_ID=管理者グループID
export HR_GROUP_ID=人事部グループID

# アプリケーションドメイン名
export APPLICATION_DOMAIN=verified-access-ecs.example.com

# ACM証明書のARN
export DOMAIN_CERTIFICATE_ARN=arn:aws:acm:ap-northeast-1:123456789012:certificate/xxxxx

# CDK設定
export SKIP_BOOTSTRAP=yes
export CDK_DOCKER=podman  # または docker

# リージョン（オプション）
export AWS_REGION=ap-northeast-1
```

### ステップ4: 環境変数の確認

```bash
cat << EOF
========================================
環境変数の確認
========================================
AWS_PROFILE: $AWS_PROFILE
ADMIN_GROUP_ID: $ADMIN_GROUP_ID
HR_GROUP_ID: $HR_GROUP_ID
APPLICATION_DOMAIN: $APPLICATION_DOMAIN
DOMAIN_CERTIFICATE_ARN: $DOMAIN_CERTIFICATE_ARN
SKIP_BOOTSTRAP: $SKIP_BOOTSTRAP
CDK_DOCKER: $CDK_DOCKER
AWS_REGION: $AWS_REGION
========================================
EOF
```

### ステップ5: TypeScriptのビルド

```bash
npm run build
```

---

## 初回デプロイ

### ステップ1: CDK Bootstrapの実行（初回のみ）

```bash
cdk bootstrap

# 特定のリージョン・アカウントを指定する場合
cdk bootstrap aws://123456789012/ap-northeast-1
```

**Bootstrap時に作成されるリソース:**
- CDKToolkit CloudFormationスタック
- S3バケット（CDKアセット用）
- ECRリポジトリ（Dockerイメージ用）
- IAMロール（CDKデプロイ用）

### ステップ2: CDK Synthの実行

```bash
# CloudFormationテンプレートの生成
cdk synth

# 生成されたテンプレートを確認
cat cdk.out/CdkVerifiedAccessEcsStack.template.json | jq .
```

### ステップ3: 初回デプロイの実行

```bash
# デプロイスクリプトを使用（推奨）
./deploy.sh
# 「初回デプロイですか？」で「y」を入力

# または、直接CDKコマンドを使用
cdk deploy
```

**デプロイ時間:** 約10-15分

**初回デプロイで作成されるリソース:**
```
1. VPC
   - パブリックサブネット × 2
   - プライベートサブネット × 2
   - インターネットゲートウェイ
   - NAT Gateway × 1
   - ルートテーブル

2. セキュリティグループ
   - ALB用
   - ECS Fargate用

3. Application Load Balancer
   - 内部ALB（Internet-facing: false）
   - ターゲットグループ（IPターゲット）
   - HTTPリスナー（ポート80）

4. ECS Cluster
   - Container Insights有効

5. ECS Task Definition
   - CPU: 0.25 vCPU
   - メモリ: 512 MB
   - コンテナイメージ（ECRから自動ビルド）

6. ECS Service
   - 初期タスク数: 2
   - Auto Scaling設定
     - 最小: 1タスク
     - 最大: 4タスク
     - CPU使用率70%でスケール
     - メモリ使用率80%でスケール

7. ECRリポジトリ + Dockerイメージ
   - イメージのビルド・プッシュ（自動）

8. Verified Access Instance
   - Trust Provider（IAM Identity Center）
   - CloudWatch Logs統合

9. Verified Access Group
   - パスベースポリシー設定

10. CloudWatch Logs
    - /aws/verifiedaccess/ecs（Verified Access用）
    - /aws/ecs/webapp（ECSタスク用）
```

### ステップ4: デプロイ結果の確認

```bash
# CloudFormationスタックの確認
aws cloudformation describe-stacks \
  --stack-name CdkVerifiedAccessEcsStack \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'

# ECS Serviceの確認
aws ecs describe-services \
  --cluster verified-access-ecs-cluster \
  --services verified-access-webapp-service \
  --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount}'
```

---

## 2回目のデプロイ

初回デプロイではVerified Accessエンドポイントを作成していないため、2回目のデプロイが必要です。

### なぜ2回必要なのか？

Verified AccessエンドポイントはALBとターゲットグループが存在している必要があります。初回デプロイでこれらを作成し、2回目でエンドポイントを作成します。

### 2回目のデプロイ実行

```bash
# 環境変数が設定されていることを確認（.envファイルを使用している場合は自動読み込み）
echo $ADMIN_GROUP_ID
echo $HR_GROUP_ID
echo $APPLICATION_DOMAIN

# デプロイスクリプトを使用
./deploy.sh
# 「初回デプロイですか？」で「N」を入力

# または、直接CDKコマンドを使用
cdk deploy
```

**デプロイ時間:** 約3-5分

**2回目のデプロイで作成されるリソース:**
- Verified Access Endpoint（HTTPS）
  - カスタムドメイン: APPLICATION_DOMAIN
  - ACM証明書の適用
  - ALBとの接続

---

## DNS設定

### Route 53の場合

#### 方法1: AWS Management Console

1. Route 53コンソールを開く
2. ホストゾーンを選択（example.com）
3. 「レコードを作成」をクリック
4. レコード情報を入力:
   - **レコード名**: `verified-access-ecs`
   - **レコードタイプ**: `A - IPv4アドレス`
   - **エイリアス**: `はい`
   - **エイリアス先**: Verified Accessエンドポイント
   - **ルーティングポリシー**: `シンプル`

#### 方法2: AWS CLI

```bash
# Verified Accessエンドポイントドメインの取得
VA_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name CdkVerifiedAccessEcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`VerifiedAccessEndpointDomain`].OutputValue' \
  --output text)

# Route 53ホストゾーンIDの取得
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --query "HostedZones[?Name=='example.com.'].Id" \
  --output text | cut -d'/' -f3)

# Aレコード（エイリアス）の作成
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch file://dns-change.json
```

**dns-change.json:**
```json
{
  "Changes": [
    {
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "verified-access-ecs.example.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z1234567890ABC",
          "DNSName": "verified-access-xxxxx.execute-api.ap-northeast-1.amazonaws.com",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
```

### 外部DNS（Cloudflare等）の場合

1. DNSプロバイダーの管理画面を開く
2. CNAMEレコードを作成:
   - **名前**: `verified-access-ecs`
   - **値**: Verified Accessエンドポイントドメイン
   - **TTL**: 300

---

## 動作確認

### 1. DNS伝播の確認

```bash
# nslookupで確認
nslookup verified-access-ecs.example.com

# digで確認
dig verified-access-ecs.example.com

# curlで確認（HTTPヘッダー）
curl -I https://verified-access-ecs.example.com/
```

### 2. 公開ページのテスト

```bash
# トップページ
curl -s https://verified-access-ecs.example.com/ | grep "<title>"

# 公開ページ
curl -s https://verified-access-ecs.example.com/public/about.html | grep "<h1>"

# ヘルスチェック
curl -s https://verified-access-ecs.example.com/health
```

### 3. 管理画面のテスト（ブラウザ）

1. ブラウザで以下にアクセス:
   ```
   https://verified-access-ecs.example.com/admin/dashboard.html
   ```

2. IAM Identity Centerの認証画面が表示される

3. **管理者グループに所属するユーザー**でログイン

4. 管理画面が表示されることを確認

5. 人事部ページのテスト:
   ```
   https://verified-access-ecs.example.com/hr/employees.html
   ```
   - **人事部グループに所属するユーザー**でログインすると表示される
   - 他のユーザーではアクセスできないことを確認

6. 人事部管理者ページのテスト:
   ```
   https://verified-access-ecs.example.com/hr-admin/dashboard.html
   ```
   - **人事部グループかつ管理者グループの両方に所属するユーザー**のみアクセス可能

### 4. CloudWatch Logsの確認

```bash
# リアルタイムでログを監視
aws logs tail /aws/verifiedaccess/ecs --follow

# 直近10分のログを表示
aws logs tail /aws/verifiedaccess/ecs --since 10m

# 特定のパターンで検索
aws logs filter-log-events \
  --log-group-name /aws/verifiedaccess/ecs \
  --filter-pattern '{ $.policyEvaluation.result = "DENY" }'
```

### 5. ECS Serviceの状態確認

```bash
# サービスの状態
aws ecs describe-services \
  --cluster verified-access-ecs-cluster \
  --services verified-access-webapp-service

# 実行中のタスク一覧
aws ecs list-tasks \
  --cluster verified-access-ecs-cluster \
  --service-name verified-access-webapp-service

# タスクの詳細
aws ecs describe-tasks \
  --cluster verified-access-ecs-cluster \
  --tasks <task-arn>
```

---

## トラブルシューティング

### Issue 1: デプロイが失敗する

**原因と対処法:**

1. **環境変数が設定されていない**
   ```bash
   # 環境変数を確認
   env | grep -E "ADMIN_GROUP_ID|HR_GROUP_ID|APPLICATION_DOMAIN|DOMAIN_CERTIFICATE_ARN"
   ```

2. **ACM証明書が見つからない**
   ```bash
   # 証明書の存在確認
   aws acm describe-certificate \
     --certificate-arn $DOMAIN_CERTIFICATE_ARN \
     --region ap-northeast-1
   ```

3. **CDK Bootstrapが未実行**
   ```bash
   cdk bootstrap
   ```

### Issue 2: ECS Taskが起動しない

**原因と対処法:**

1. **Dockerイメージのビルドエラー**
   ```bash
   # ローカルでビルドテスト
   cd docker
   podman build -t test .
   ```

2. **タスク定義のリソース不足**
   ```bash
   # タスクのイベントを確認
   aws ecs describe-services \
     --cluster verified-access-ecs-cluster \
     --services verified-access-webapp-service \
     --query 'services[0].events[0:5]'
   ```

3. **サブネットのIP枯渇**
   ```bash
   # サブネットの利用可能IP確認
   aws ec2 describe-subnets \
     --filters "Name=tag:Name,Values=*Private*" \
     --query 'Subnets[*].{SubnetId:SubnetId,AvailableIps:AvailableIpAddressCount}'
   ```

### Issue 3: 認証ページにリダイレクトされない

**原因と対処法:**

1. **Trust Providerの設定確認**
   ```bash
   # Trust Providerの確認
   aws ec2 describe-verified-access-trust-providers
   ```

2. **ポリシーの有効化確認**
   ```bash
   # Verified Access Groupの確認
   aws ec2 describe-verified-access-groups \
     --query 'VerifiedAccessGroups[*].{PolicyEnabled:PolicyEnabled}'
   ```

### Issue 4: 部署別ページにアクセスできない

**原因と対処法:**

1. **IAM Identity Centerの属性確認**
   - Management Consoleで部署属性（department）が設定されているか確認

2. **ポリシーの確認**
   ```bash
   # スタックの確認
   aws cloudformation get-template \
     --stack-name CdkVerifiedAccessEcsStack \
     --query 'TemplateBody' | jq '.Resources.VerifiedAccessGroup.Properties.PolicyDocument'
   ```

---

## 環境のクリーンアップ

### すべてのリソースを削除

```bash
# CDKスタックの削除
cdk destroy

# 確認プロンプトで「y」を入力
```

**削除されるリソース:**
- VPC、サブネット、NAT Gateway
- ALB、ターゲットグループ
- ECS Cluster、Service、Task Definition
- Verified Access関連リソース
- CloudWatch Logsグループ
- ECRリポジトリ

**手動で削除が必要なリソース:**
- Route 53のDNSレコード
- ACM証明書
- IAM Identity Centerのユーザー

---

## 📚 参考リンク

- [AWS Verified Access 公式ドキュメント](https://docs.aws.amazon.com/verified-access/)
- [ECS Fargate 公式ドキュメント](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [AWS CDK 公式ドキュメント](https://docs.aws.amazon.com/cdk/)
- [IAM Identity Center 公式ドキュメント](https://docs.aws.amazon.com/singlesignon/)

---

**作成日**: 2025-12-07  
**最終更新**: 2025-12-07

