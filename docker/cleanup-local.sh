#!/bin/bash
# ローカルテスト環境のクリーンアップスクリプト（Podman/Docker対応）

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

CONTAINER_NAME="verified-access-test"
IMAGE_NAME="verified-access-webapp:latest"

# コンテナの停止
echo -e "${GREEN}[1/3] コンテナを停止しています...${NC}"
if $CONTAINER_CMD ps -a | grep -q $CONTAINER_NAME; then
    $CONTAINER_CMD stop $CONTAINER_NAME 2>/dev/null || echo "既に停止しています"
else
    echo "コンテナ $CONTAINER_NAME が見つかりません（スキップ）"
fi

# コンテナの削除
echo -e "\n${GREEN}[2/3] コンテナを削除しています...${NC}"
if $CONTAINER_CMD ps -a | grep -q $CONTAINER_NAME; then
    $CONTAINER_CMD rm $CONTAINER_NAME 2>/dev/null || echo "既に削除されています"
    echo "✅ コンテナを削除しました"
else
    echo "コンテナ $CONTAINER_NAME が見つかりません（スキップ）"
fi

# イメージの削除確認
echo -e "\n${GREEN}[3/3] イメージの削除確認${NC}"
if $CONTAINER_CMD images | grep -q verified-access-webapp; then
    read -p "イメージ $IMAGE_NAME も削除しますか？ (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        $CONTAINER_CMD rmi localhost/$IMAGE_NAME
        echo "✅ イメージを削除しました"
    else
        echo "イメージは保持されます"
    fi
else
    echo "イメージが見つかりません（スキップ）"
fi

# 確認
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ クリーンアップが完了しました！${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${BLUE}現在のコンテナ:${NC}"
$CONTAINER_CMD ps -a | grep verified-access || echo "（なし）"

echo -e "\n${BLUE}現在のイメージ:${NC}"
$CONTAINER_CMD images | grep verified-access || echo "（なし）"
echo -e ""

