#!/bin/bash
# ローカルテスト用スクリプト（Podman/Docker対応）

set -e

# 色付き出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Docker/Podmanの検出
if command -v podman &> /dev/null; then
    CONTAINER_CMD="podman"
elif command -v docker &> /dev/null; then
    CONTAINER_CMD="docker"
else
    echo -e "${RED}Error: podman または docker がインストールされていません${NC}"
    exit 1
fi

echo -e "${BLUE}使用するコマンド: ${CONTAINER_CMD}${NC}\n"

IMAGE_NAME="verified-access-webapp:latest"
CONTAINER_NAME="verified-access-test"
PORT="8080"

# ステップ1: イメージのビルド
echo -e "${GREEN}[1/5] Dockerイメージをビルドしています...${NC}"
$CONTAINER_CMD build -t $IMAGE_NAME .

# ステップ2: イメージの確認
echo -e "\n${GREEN}[2/5] ビルドしたイメージを確認しています...${NC}"
$CONTAINER_CMD images | grep verified-access-webapp || echo "イメージが見つかりません"

# ステップ3: コンテナの起動
echo -e "\n${GREEN}[3/5] コンテナを起動しています...${NC}"
$CONTAINER_CMD run -d --name $CONTAINER_NAME -p $PORT:80 localhost/$IMAGE_NAME

# ステップ4: コンテナの状態確認
echo -e "\n${GREEN}[4/5] コンテナの状態を確認しています...${NC}"
sleep 2
$CONTAINER_CMD ps | grep $CONTAINER_NAME

# ステップ5: アクセステスト
echo -e "\n${GREEN}[5/5] アクセステストを実行しています...${NC}"

echo -e "\n${BLUE}--- トップページ ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/

echo -e "\n${BLUE}--- 公開ページ ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/public/about.html

echo -e "\n${BLUE}--- 管理画面 ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/admin/dashboard.html

echo -e "\n${BLUE}--- 人事システム ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/hr/employees.html

echo -e "\n${BLUE}--- 経理システム ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/finance/budget.html

echo -e "\n${BLUE}--- 役員専用 ---${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:$PORT/executive/strategy.html

echo -e "\n${BLUE}--- ヘルスチェック ---${NC}"
curl -s http://localhost:$PORT/health

echo -e "\n\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ ローカルテストが完了しました！${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\n${YELLOW}ブラウザで確認:${NC} http://localhost:$PORT/"
echo -e "\n${YELLOW}ログを確認:${NC}"
echo -e "  $CONTAINER_CMD logs $CONTAINER_NAME"
echo -e "\n${YELLOW}コンテナを停止・削除:${NC}"
echo -e "  $CONTAINER_CMD stop $CONTAINER_NAME"
echo -e "  $CONTAINER_CMD rm $CONTAINER_NAME"
echo -e ""

