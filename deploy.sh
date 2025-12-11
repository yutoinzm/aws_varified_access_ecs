#!/bin/bash
# AWS CDK デプロイスクリプト（ECS Fargate + Verified Access）

set -e

# 色付き出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ヘッダー表示
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AWS Verified Access - ECS Fargate${NC}"
echo -e "${BLUE}デプロイスクリプト${NC}"
echo -e "${BLUE}========================================${NC}\n"

# .envファイルの読み込み
echo -e "${GREEN}[1/8] .envファイルを読み込んでいます...${NC}"

if [ -f .env ]; then
    echo -e "${GREEN}✅ .envファイルが見つかりました${NC}"
    # .envファイルを読み込む（特殊文字対応版）
    # コメント行と空行を除外した一時ファイルを作成
    grep -v '^#' .env | grep -v '^$' > /tmp/.env.tmp
    set -a  # 以降の変数を自動的にexport
    source /tmp/.env.tmp
    set +a  # 自動exportを解除
    rm -f /tmp/.env.tmp
    echo -e "${BLUE}環境変数を.envファイルから読み込みました${NC}"
else
    echo -e "${YELLOW}⚠️  .envファイルが見つかりません${NC}"
    echo -e "${YELLOW}以下のいずれかの方法で環境変数を設定してください:${NC}"
    echo -e "  1. .env.exampleをコピーして.envを作成"
    echo -e "     cp .env.example .env"
    echo -e "     vim .env"
    echo -e "  2. 環境変数を直接exportで設定"
    echo -e "     export ALLOWED_USER_EMAIL=your@email.com"
    echo -e ""
    read -p ".envファイルなしで続行しますか？ (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}デプロイを中止しました${NC}"
        exit 1
    fi
fi

# 環境変数のチェック
echo -e "\n${GREEN}[2/8] 環境変数をチェックしています...${NC}"

if [ -z "$ADMIN_GROUP_ID" ]; then
    echo -e "${RED}Error: ADMIN_GROUP_ID が設定されていません${NC}"
    echo -e "${YELLOW}以下のコマンドで設定してください:${NC}"
    echo -e "export ADMIN_GROUP_ID=g-1234567890abcdef"
    exit 1
fi

if [ -z "$HR_GROUP_ID" ]; then
    echo -e "${RED}Error: HR_GROUP_ID が設定されていません${NC}"
    echo -e "${YELLOW}以下のコマンドで設定してください:${NC}"
    echo -e "export HR_GROUP_ID=f79d6ad8-1da1-7b36-4ad3-53dad7cc2iff"
    exit 1
fi

if [ -z "$APPLICATION_DOMAIN" ]; then
    echo -e "${RED}Error: APPLICATION_DOMAIN が設定されていません${NC}"
    echo -e "${YELLOW}以下のコマンドで設定してください:${NC}"
    echo -e "export APPLICATION_DOMAIN=verified-access-ecs.example.com"
    exit 1
fi

if [ -z "$DOMAIN_CERTIFICATE_ARN" ]; then
    echo -e "${RED}Error: DOMAIN_CERTIFICATE_ARN が設定されていません${NC}"
    echo -e "${YELLOW}以下のコマンドで設定してください:${NC}"
    echo -e "export DOMAIN_CERTIFICATE_ARN=arn:aws:acm:ap-northeast-1:xxxxx:certificate/xxxxx"
    exit 1
fi

echo -e "${GREEN}✅ 環境変数が設定されています${NC}"
echo -e "  - ADMIN_GROUP_ID: $ADMIN_GROUP_ID"
echo -e "  - HR_GROUP_ID: $HR_GROUP_ID"
echo -e "  - APPLICATION_DOMAIN: $APPLICATION_DOMAIN"
echo -e "  - DOMAIN_CERTIFICATE_ARN: ${DOMAIN_CERTIFICATE_ARN:0:50}..."

# AWSプロファイルの確認
if [ -n "$AWS_PROFILE" ]; then
    echo -e "  - AWS_PROFILE: $AWS_PROFILE"
fi

# 依存関係のインストール
echo -e "\n${GREEN}[3/8] 依存関係をインストールしています...${NC}"
npm install

# TypeScriptのビルド
echo -e "\n${GREEN}[4/8] TypeScriptをビルドしています...${NC}"
npm run build

# CDK Bootstrapの確認
echo -e "\n${GREEN}[5/8] CDK Bootstrapを確認しています...${NC}"
echo -e "${YELLOW}※ 初回デプロイの場合は、CDK Bootstrapが必要です${NC}"

# .envでSKIP_BOOTSTRAPが設定されている場合はスキップ
if [ "$SKIP_BOOTSTRAP" = "yes" ]; then
    echo -e "${YELLOW}Bootstrap をスキップしました（SKIP_BOOTSTRAP=yes）${NC}"
else
    read -p "CDK Bootstrapを実行しますか？ (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cdk bootstrap
        echo -e "${GREEN}✅ Bootstrap完了${NC}"
    else
        echo -e "${YELLOW}Bootstrap をスキップしました${NC}"
    fi
fi

# 初回デプロイかどうか確認
echo -e "\n${GREEN}[6/8] デプロイタイプを確認しています...${NC}"
echo -e "${YELLOW}初回デプロイ: Verified Accessエンドポイントを作成しない${NC}"
echo -e "${YELLOW}2回目以降: Verified Accessエンドポイントを作成する${NC}"
read -p "初回デプロイですか？ (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    IS_FIRST_DEPLOY="true"
    echo -e "${BLUE}初回デプロイモードで実行します${NC}"
else
    IS_FIRST_DEPLOY="false"
    echo -e "${BLUE}2回目以降のデプロイモードで実行します${NC}"
fi

# CDK Synthの実行
echo -e "\n${GREEN}[7/8] CDK Synthを実行しています...${NC}"
cdk synth

# CDK Deployの実行
echo -e "\n${GREEN}[8/8] CDK Deployを実行しています...${NC}"
echo -e "${YELLOW}※ デプロイには10-15分程度かかります（Dockerイメージのビルド・ECRプッシュ含む）${NC}"
echo -e "${YELLOW}※ IAMロール、セキュリティグループなどの作成確認が表示されます${NC}\n"

cdk deploy --parameters IsFirstDeploy=$IS_FIRST_DEPLOY

# デプロイ完了
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ デプロイが完了しました！${NC}"
echo -e "${GREEN}========================================${NC}\n"

if [ "$IS_FIRST_DEPLOY" = "true" ]; then
    echo -e "${YELLOW}【重要】初回デプロイが完了しました${NC}"
    echo -e "${YELLOW}次のステップ: 2回目のデプロイを実行してVerified Accessエンドポイントを作成してください${NC}\n"
    echo -e "${BLUE}手順:${NC}"
    echo -e "1. 同じ環境変数を設定"
    echo -e "2. ./deploy.sh を再実行"
    echo -e "3. 「初回デプロイですか？」で「N」を選択\n"
else
    echo -e "${GREEN}【完了】すべてのリソースがデプロイされました${NC}\n"
    echo -e "${BLUE}次のステップ:${NC}"
    echo -e "1. CloudFormationの出力からエンドポイントURLを確認"
    echo -e "2. Route 53でDNSレコードを設定（APPLICATION_DOMAINをVerified Accessエンドポイントに向ける）"
    echo -e "3. ブラウザで https://$APPLICATION_DOMAIN/ にアクセス\n"
    
    echo -e "${YELLOW}CloudFormationの出力を確認:${NC}"
    echo -e "aws cloudformation describe-stacks --stack-name CdkVerifiedAccessEcsStack --query 'Stacks[0].Outputs'\n"
fi

echo -e "${BLUE}ログの確認:${NC}"
echo -e "aws logs tail /aws/verifiedaccess/ecs --follow\n"

echo -e "${BLUE}ECS Serviceの確認:${NC}"
echo -e "aws ecs describe-services --cluster verified-access-ecs-cluster --services verified-access-webapp-service\n"

echo -e "${GREEN}デプロイスクリプトが正常に終了しました${NC}"

