# クイックスタートガイド

> 最短10分でAWS Verified Access + ECS Fargateをデプロイ

---

## 🎯 このガイドの目的

このガイドでは、最小限の手順でVerified Access + ECS Fargateをデプロイし、動作確認まで行います。

**所要時間:** 約15-20分（初回デプロイ含む）

---

## ✅ 前提条件

### 必須
- ✅ AWS CLIがインストール・設定済み
- ✅ AWS CDK v2がインストール済み (`npm install -g aws-cdk`)
- ✅ Node.js 18以上がインストール済み
- ✅ IAM Identity Centerが有効化済み
- ✅ Route 53またはカスタムドメインの準備
- ✅ ACM証明書の作成済み

### オプション
- Podman/Docker（ローカルテスト用）

---

## 🚀 5ステップでデプロイ

### ステップ1: リポジトリのクローンと準備

```bash
# リポジトリのクローン
git clone <repository-url>
cd cdk-verified-access-ecs

# 依存関係のインストール
npm install
```

---

### ステップ2: 環境変数の設定（.envファイル推奨）

#### 方法1: .envファイルを使用（推奨）

```bash
# .env.exampleをコピー
cp .env.example .env

# .envファイルを編集
vim .env
```

**.envファイルの内容例:**
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

#### 方法2: 環境変数を直接設定

```bash
export AWS_PROFILE=your-profile
export ADMIN_GROUP_ID=管理者グループID
export HR_GROUP_ID=人事部グループID
export APPLICATION_DOMAIN=verified-access-ecs.example.com
export DOMAIN_CERTIFICATE_ARN=arn:aws:acm:ap-northeast-1:123456789012:certificate/xxxxx
export SKIP_BOOTSTRAP=yes
export CDK_DOCKER=podman
export AWS_REGION=ap-northeast-1
```

---

### ステップ3: 初回デプロイ

```bash
# デプロイスクリプトを実行（.envファイルを自動読み込み）
./deploy.sh

# 「初回デプロイですか？」の質問で「y」を入力
# デプロイには約10-15分かかります
```

**デプロイスクリプトの動作:**
1. .envファイルを自動的に読み込み
2. 環境変数のチェック
3. 依存関係のインストール
4. TypeScriptのビルド
5. CDKデプロイの実行

**初回デプロイで作成されるリソース:**
- VPC（パブリック・プライベートサブネット）
- NAT Gateway
- Application Load Balancer（内部ALB）
- ECS Cluster
- ECS Task Definition
- ECS Service（Auto Scaling設定済み）
- ECRリポジトリ + Dockerイメージ
- Verified Access Instance
- Verified Access Group（パスベースポリシー）
- Trust Provider（IAM Identity Center）
- CloudWatch Logs

---

### ステップ4: 2回目のデプロイ（Verified Accessエンドポイント作成）

```bash
# 再度デプロイ（.envファイルから自動読み込み）
./deploy.sh

# 「初回デプロイですか？」の質問で「N」を入力
```

**注**: .envファイルを使用している場合、環境変数を再設定する必要はありません。

**2回目のデプロイで作成されるリソース:**
- Verified Access Endpoint（HTTPS）

---

### ステップ5: DNS設定とアクセス確認

#### 5-1. CloudFormationの出力確認

```bash
aws cloudformation describe-stacks \
  --stack-name CdkVerifiedAccessEcsStack \
  --query 'Stacks[0].Outputs'
```

**出力例:**
```json
[
  {
    "OutputKey": "VerifiedAccessEndpointUrl",
    "OutputValue": "https://verified-access-ecs.example.com"
  },
  {
    "OutputKey": "AlbDnsName",
    "OutputValue": "internal-xxxx.ap-northeast-1.elb.amazonaws.com"
  }
]
```

#### 5-2. Route 53でDNSレコードを設定

1. Route 53コンソールを開く
2. ホストゾーンを選択
3. レコードを作成:
   - **レコード名**: `verified-access-ecs`（または任意）
   - **レコードタイプ**: A（エイリアス）
   - **エイリアス先**: Verified Accessエンドポイント

#### 5-3. ブラウザでアクセス

```
https://verified-access-ecs.example.com/
```

**期待される動作:**
1. Verified AccessエンドポイントにアクセスするとIAM Identity Centerのログイン画面が表示
2. ログイン後、公開ページ（`/`）は認証済みユーザーなら誰でも表示
3. 管理画面（`/admin/dashboard.html`）は管理者グループのユーザーのみ表示
4. 人事部ページ（`/hr/employees.html`）は人事部グループのユーザーのみ表示

---

## 🧪 動作確認

### 公開ページのテスト

ブラウザで以下にアクセス:
```
https://verified-access-ecs.example.com/
https://verified-access-ecs.example.com/public/about.html
```

**期待される動作:**
1. IAM Identity Centerの認証画面が表示
2. ログイン後、認証済みユーザーなら誰でもアクセス可能

### 管理画面のテスト（管理者グループのみ）

ブラウザで以下にアクセス:
```
https://verified-access-ecs.example.com/admin/dashboard.html
```

**期待される動作:**
1. IAM Identity Centerの認証画面が表示
2. 管理者グループに所属するユーザーでログイン
3. 管理画面が表示

### 人事部ページのテスト（人事部グループのみ）

ブラウザで以下にアクセス:
```
https://verified-access-ecs.example.com/hr/employees.html
```

**期待される動作:**
1. IAM Identity Centerの認証画面が表示
2. 人事部グループに所属するユーザーでログイン
3. 人事部ページが表示
---

## 📊 CloudWatch Logsの確認

```bash
# リアルタイムでログを監視
aws logs tail /aws/verifiedaccess/ecs --follow

# 直近のログを表示
aws logs tail /aws/verifiedaccess/ecs --since 10m
```

**ログ例（成功）:**
```json
{
  "timestamp": "2025-12-07T12:34:56Z",
  "user": {
    "email": "user@example.com"
  },
  "request": {
    "path": "/",
    "method": "GET"
  },
  "policyEvaluation": {
    "result": "ALLOW"
  }
}
```

---

## 🧹 環境のクリーンアップ

### すべてのリソースを削除

```bash
cdk destroy
```

**削除されるリソース:**
- すべてのCDKスタックリソース
- ECRリポジトリ（イメージ含む）
- CloudWatch Logsグループ

**削除されないリソース（手動削除が必要）:**
- Route 53のDNSレコード
- ACM証明書

---

## 🔧 トラブルシューティング

### デプロイが失敗する

```bash
# エラーメッセージを確認
cdk deploy --verbose

# CloudFormationイベントを確認
aws cloudformation describe-stack-events --stack-name CdkVerifiedAccessEcsStack
```

### ECS Taskが起動しない

```bash
# ECS Serviceの状態確認
aws ecs describe-services \
  --cluster verified-access-ecs-cluster \
  --services verified-access-webapp-service

# ECS Taskのログ確認
aws logs tail /aws/ecs/webapp --follow
```

### Dockerイメージのビルドが失敗する

```bash
# ローカルでビルドテスト
cd docker
podman build -t test .
```

### 認証ページにリダイレクトされない

1. IAM Identity Centerが有効化されているか確認
2. Trust Providerが正しく設定されているか確認
3. ポリシーが有効になっているか確認

---

## 📚 次のステップ

### さらに詳しく学ぶ

- [LOCAL_TEST_GUIDE.md](./LOCAL_TEST_GUIDE.md) - ローカルテスト手順
- [README.md](./README.md) - プロジェクトの詳細説明

### カスタマイズ

1. **HTMLページの編集**: `docker/app/` 内のHTMLファイルを編集
2. **ポリシーの追加**: `lib/cdk-verified-access-ecs-stack.ts` のpolicyRulesを編集
3. **ECSタスクのスペック変更**: TaskDefinitionのmemory/cpu設定を変更

---

## ❓ よくある質問

### Q1: コストはどのくらいかかりますか？

**A:** 月間運用コスト（平日8時間 × 20日）:
- Verified Access: 約$8
- ECS Fargate: 約$6.50
- ALB: 約$45
- NAT Gateway: 約$33
- **合計: 約$92.50/月**

### Q2: Auto Scalingの設定を変更できますか？

**A:** はい。`lib/cdk-verified-access-ecs-stack.ts` の以下を編集:
```typescript
minCapacity: 1,  // 最小タスク数
maxCapacity: 4,  // 最大タスク数
```

### Q3: 本番環境で使えますか？

**A:** はい。以下の点を考慮してください:
- タスクのスペックを増やす（0.5 vCPU, 1GB以上推奨）
- マルチAZ構成の確認
- バックアップ・監視の設定
- セキュリティレビュー

### Q4: Dockerなしでデプロイできますか？

**A:** はい。CDKが自動的にDockerイメージをビルドします。ただし、ローカルテストはできません。

---

**最終更新**: 2025-12-11

