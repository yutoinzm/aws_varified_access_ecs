# AWS Verified Access - ECS Fargate【実践編】

> パスベースアクセス制御で本番環境に対応した構成

---

## 📋 概要

このプロジェクトは、AWS Verified AccessとECS Fargateを組み合わせて、パスベースのゼロトラストアクセス制御を実現するCDKプロジェクトです。

### 第一弾との違い

| 項目 | 第一弾【基礎編】 | 第二弾【実践編】（本プロジェクト） |
|------|----------------|----------------|
| **構成** | EC2 + Nginx | **ECS Fargate + Docker** |
| **アクセス制御** | 全ページ一括保護 | **パスベースの部分的保護** |
| **ユースケース** | シンプルな学習用 | **本番環境相当** |
| **ポリシー** | 基本（ユーザー認証のみ） | **高度（パス + 部署 + 役職）** |
| **スケール** | 手動 | **自動スケール** |
| **デプロイ** | SSH/手動 | **コンテナ更新** |

---

## 🎯 主な機能

### ✅ パスベースアクセス制御

| パス | アクセス制御 | 対象ユーザー |
|------|-------------|-------------|
| `/` | 公開 | 認証済みユーザーは誰でもアクセス可能 |
| `/public/*` | 公開 | 認証済みユーザーは誰でもアクセス可能 |
| `/admin/*` | 管理者グループのみ | IAM Identity Centerの管理者グループ |
| `/hr/*` | 人事部グループのみ | IAM Identity Centerの人事部グループ |
| `/hr-admin/*` | 複合制限 | 人事部グループ + 管理者グループの両方 |

### ✅ ECS Fargateの利点

1. **コンテナ化** - Dockerで可搬性向上
2. **Auto Scaling** - CPU/メモリ使用率ベースで自動スケール
3. **運用効率** - OS管理不要
4. **デプロイ速度** - コンテナ更新のみ
5. **コスト最適化** - 使った分だけ課金

---

## 🏗️ アーキテクチャ

```
開発者PC → Verified Access → ALB → ECS Fargate (Docker)
              ↓ 認証
      IAM Identity Center
              ↓ ポリシー評価
         パスベース制御
```

### デプロイされるAWSリソース

- **VPC** - パブリック・プライベートサブネット
- **Application Load Balancer** - 内部ALB
- **ECS Cluster** - Fargateクラスター
- **ECS Service** - Auto Scaling対応
- **Verified Access Instance** - ゼロトラストアクセス
- **Verified Access Group** - パスベースポリシー
- **Trust Provider** - IAM Identity Center統合
- **CloudWatch Logs** - アクセスログ記録

---

## 📦 前提条件

- AWS CLI設定済み
- AWS CDK v2インストール済み
- Node.js 18以上
- Docker（ローカルビルド用）
- IAM Identity Centerの有効化

---

## 🚀 クイックスタート

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd cdk-verified-access-ecs
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定（.envファイル推奨）

```bash
# .env.exampleをコピー
cp .env.example .env

# .envファイルを編集
vim .env
```

**設定する項目:**
```bash
ADMIN_GROUP_ID=管理者グループID
HR_GROUP_ID=人事部グループID
APPLICATION_DOMAIN=verified-access-ecs.example.com
DOMAIN_CERTIFICATE_ARN=arn:aws:acm:ap-northeast-1:xxxxx:certificate/xxxxx
SKIP_BOOTSTRAP=yes
CDK_DOCKER=podman  # または docker
AWS_PROFILE=your-profile  # オプション
AWS_REGION=ap-northeast-1  # オプション
```

### 4. デプロイ実行

```bash
# デプロイスクリプトを実行（.envファイルを自動読み込み）
./deploy.sh

# 初回デプロイの場合: 「y」を入力
# 2回目のデプロイの場合: 「N」を入力
```

**または、CDKコマンドを直接使用:**
```bash
# TypeScriptのビルド
npm run build

# デプロイ
cdk deploy
```

---

## 📚 ポリシー設定の詳細

### Cedar言語でのポリシー定義

実際に使用しているポリシーは `lib/cdk-verified-access-ecs-stack.ts` で定義されています。

#### 1. 管理者ページへのアクセス

```cedar
permit(principal, action, resource) when {
  context.http_request.path like "admin/*" &&
  (context.IAMIdentityCenter.groups has "管理者グループID")
};
```

#### 2. 人事部ページへのアクセス

```cedar
permit(principal, action, resource) when {
  context.http_request.path like "hr/*" &&
  !(context.http_request.path like "/hr-admin/*") &&
  (context.IAMIdentityCenter.groups has "人事部グループID")
};
```

#### 3. 人事部管理者ページへのアクセス

```cedar
permit(principal, action, resource) when {
  context.http_request.path like "hr-admin/*" &&
  (context.IAMIdentityCenter.groups has "管理者グループID") &&
  (context.IAMIdentityCenter.groups has "人事部グループID")
};
```

#### 4. その他のパス（公開ページ）

```cedar
permit(principal, action, resource) when {
  !(context.http_request.path like "admin/*") &&
  !(context.http_request.path like "hr/*") &&
  !(context.http_request.path like "hr-admin/*")
};
```

---

## 🧪 動作確認

### アクセステスト

1. **公開ページ** - ブラウザで `https://your-domain/` にアクセス → IAM Identity Centerで認証後に表示
2. **管理画面** - ブラウザで `https://your-domain/admin/dashboard.html` にアクセス → 管理者グループのユーザーのみ表示
3. **人事部ページ** - ブラウザで `https://your-domain/hr/employees.html` にアクセス → 人事部グループのユーザーのみ表示
4. **人事部管理者ページ** - ブラウザで `https://your-domain/hr-admin/dashboard.html` にアクセス → 人事部グループかつ管理者グループの両方に所属するユーザーのみ表示

### CloudWatch Logsでログ確認

```bash
aws logs tail /aws/verifiedaccess/ecs --follow
```

---

## 💰 コスト見積もり

### 月間運用コスト（想定: 平日8時間 × 20日）

| リソース | 単価 | 月額 |
|---------|-----|------|
| Verified Access | $0.05/時間 × 160時間 | $8.00 |
| ECS Fargate (0.25vCPU, 0.5GB) | $0.04048/時間 × 160時間 | $6.48 |
| ALB | $0.0225/時間 × 730時間 | $16.43 |
| ALB LCU | $0.008 × 5 × 730時間 | $29.20 |
| NAT Gateway | $0.045/時間 × 730時間 | $32.85 |
| データ転送 | $0.09/GB × 100GB | $9.00 |
| **合計** | | **約$102/月（約15,300円）** |

※ NAT Gatewayが大きなコスト要因。本番環境ではVPCエンドポイント利用も検討。

---

## 🔧 開発・カスタマイズ

### Dockerイメージのカスタマイズ

```bash
cd docker
# Dockerfileを編集
docker build -t webapp .
docker run -p 8080:80 webapp
```

### ポリシーのカスタマイズ

`lib/cdk-verified-access-ecs-stack.ts` の `policyRules` セクションを編集してください。

---

## 📚 ドキュメント

### デプロイガイド

- **[DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md)** - 詳細なデプロイ手順とトラブルシューティング
  - ACM証明書の作成方法
  - IAM Identity Centerのグループ設定とグループIDの取得方法
  - 環境変数の詳細な設定方法
  - デプロイの各ステップの詳細説明
  - トラブルシューティング

- **[QUICKSTART.md](./QUICKSTART.md)** - クイックスタートガイド（最短10分でデプロイ）
- **[LOCAL_TEST_GUIDE.md](./LOCAL_TEST_GUIDE.md)** - ローカルでのDocker/Podmanテスト手順

## 📖 参考リンク

- [AWS Verified Access 公式ドキュメント](https://docs.aws.amazon.com/verified-access/)
- [ECS Fargate 公式ドキュメント](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [Cedar ポリシー言語](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/policy-language.html)

---

## 📝 ライセンス

MIT License

---

**最終更新**: 2025-12-11

