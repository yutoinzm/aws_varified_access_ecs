# ローカルテストガイド（Podman/Docker）

> Dockerイメージをローカルでビルド・テストする手順

---

## 📋 前提条件

- Podman または Docker がインストール済み
- プロジェクトのルートディレクトリにいること

```bash
cd /path/to/cdk-verified-access-ecs
```

---

## 🔧 ステップ1: Podmanのバージョン確認

```bash
podman --version
# または
docker --version
```

**期待される出力例:**
```
podman version 5.7.0
```

---

## 🛠️ ステップ2: Dockerイメージのビルド

```bash
cd docker
podman build -t verified-access-webapp:latest .
# または
docker build -t verified-access-webapp:latest .
```

**期待される出力:**
```
STEP 1/7: FROM nginx:alpine
...
Successfully tagged localhost/verified-access-webapp:latest
```

**ビルド時間:** 約30秒〜1分

---

## 🔍 ステップ3: ビルドしたイメージの確認

```bash
podman images | grep verified-access-webapp
# または
docker images | grep verified-access-webapp
```

**期待される出力例:**
```
localhost/verified-access-webapp  latest  5e051cfbfc49  2 minutes ago  54.4 MB
```

---

## 🚀 ステップ4: コンテナの起動

```bash
podman run -d --name verified-access-test -p 8080:80 localhost/verified-access-webapp:latest
# または
docker run -d --name verified-access-test -p 8080:80 localhost/verified-access-webapp:latest
```

**オプションの説明:**
- `-d`: デタッチモード（バックグラウンド実行）
- `--name verified-access-test`: コンテナ名を指定
- `-p 8080:80`: ホストの8080ポート → コンテナの80ポートにマッピング

**期待される出力例:**
```
71780366182c9318bcc7f93d3b8c9c1597c6690a546e13b765bdf1b1e3431905
```

---

## 🔍 ステップ5: コンテナの状態確認

```bash
podman ps
# または
docker ps
```

**期待される出力例:**
```
CONTAINER ID  IMAGE                                    STATUS        PORTS                 NAMES
71780366182c  localhost/verified-access-webapp:latest  Up 10 seconds 0.0.0.0:8080->80/tcp  verified-access-test
```

---

## 🧪 ステップ6: アクセステスト

### 6-1. トップページ（公開ページ）

```bash
curl -s http://localhost:8080/ | head -20
```

**期待される出力:**
```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>AWS Verified Access - ECS Fargate【実践編】</title>
...
```

### 6-2. 公開ページ

```bash
curl -s http://localhost:8080/public/about.html | grep "<h1>"
```

**期待される出力:**
```html
<h1>✅ 公開ページにアクセスしました</h1>
```

### 6-3. 管理画面

```bash
curl -s http://localhost:8080/admin/dashboard.html | grep "<h1>"
```

**期待される出力:**
```html
<h1>🔒 管理画面ダッシュボード</h1>
```

### 6-4. 人事システム

```bash
curl -s http://localhost:8080/hr/employees.html | grep "<h1>"
```

**期待される出力:**
```html
<h1>👥 従業員管理システム</h1>
```

### 6-5. 経理システム

```bash
curl -s http://localhost:8080/finance/budget.html | grep "<h1>"
```

**期待される出力:**
```html
<h1>💰 予算管理システム</h1>
```

### 6-6. 役員専用ページ

```bash
curl -s http://localhost:8080/executive/strategy.html | grep "<h1>"
```

**期待される出力:**
```html
<h1>👔 経営戦略ページ</h1>
```

### 6-7. ヘルスチェックエンドポイント（ALB用）

```bash
curl -s http://localhost:8080/health
```

**期待される出力:**
```
healthy
```

### 6-8. HTTPステータスコードの確認

```bash
curl -I -s http://localhost:8080/ | grep "HTTP/"
```

**期待される出力:**
```
HTTP/1.1 200 OK
```

---

## 🌐 ステップ7: ブラウザでの確認

以下のURLをブラウザで開いて、見た目とリンクの動作を確認します：

1. **トップページ（公開）**: http://localhost:8080/
2. **公開ページ**: http://localhost:8080/public/about.html
3. **管理画面**: http://localhost:8080/admin/dashboard.html
4. **人事システム**: http://localhost:8080/hr/employees.html
5. **経理システム**: http://localhost:8080/finance/budget.html
6. **役員専用**: http://localhost:8080/executive/strategy.html
7. **ヘルスチェック**: http://localhost:8080/health

---

## 📊 ステップ8: コンテナのログ確認

```bash
podman logs verified-access-test
# または
docker logs verified-access-test
```

**期待される出力例（Nginxアクセスログ）:**
```
10.88.0.2 - - [07/Dec/2025:20:23:36 +0900] "GET / HTTP/1.1" 200 5558 "-" "curl/8.7.1"
10.88.0.2 - - [07/Dec/2025:20:23:41 +0900] "GET /public/about.html HTTP/1.1" 200 816 "-" "curl/8.7.1"
```

### リアルタイムでログを監視する場合

```bash
podman logs -f verified-access-test
# または
docker logs -f verified-access-test
```

（Ctrl+Cで終了）

---

## 🧹 ステップ9: クリーンアップ（コンテナの停止・削除）

### 9-1. コンテナの停止

```bash
podman stop verified-access-test
# または
docker stop verified-access-test
```

**期待される出力:**
```
verified-access-test
```

### 9-2. コンテナの削除

```bash
podman rm verified-access-test
# または
docker rm verified-access-test
```

**期待される出力:**
```
verified-access-test
```

### 9-3. コンテナの削除確認

```bash
podman ps -a | grep verified-access-test
# または
docker ps -a | grep verified-access-test
```

**期待される出力:**
```
（何も表示されない = 正常に削除された）
```

---

## 🗑️ ステップ10: イメージの削除（オプション）

イメージも削除する場合（再ビルドが必要になります）：

```bash
podman rmi localhost/verified-access-webapp:latest
# または
docker rmi localhost/verified-access-webapp:latest
```

**期待される出力:**
```
Untagged: localhost/verified-access-webapp:latest
Deleted: sha256:5e051cfbfc49...
```

---

## 📝 クイックリファレンス（全コマンド一覧）

```bash
# 1. ビルド
cd docker
podman build -t verified-access-webapp:latest .

# 2. イメージ確認
podman images | grep verified-access-webapp

# 3. コンテナ起動
podman run -d --name verified-access-test -p 8080:80 localhost/verified-access-webapp:latest

# 4. コンテナ確認
podman ps

# 5. アクセステスト（一括）
curl -s http://localhost:8080/ | head -20
curl -s http://localhost:8080/public/about.html | grep "<h1>"
curl -s http://localhost:8080/admin/dashboard.html | grep "<h1>"
curl -s http://localhost:8080/hr/employees.html | grep "<h1>"
curl -s http://localhost:8080/finance/budget.html | grep "<h1>"
curl -s http://localhost:8080/executive/strategy.html | grep "<h1>"
curl -s http://localhost:8080/health

# 6. HTTPステータス確認
curl -I -s http://localhost:8080/ | grep "HTTP/"

# 7. ログ確認
podman logs verified-access-test

# 8. クリーンアップ
podman stop verified-access-test
podman rm verified-access-test

# 9. イメージ削除（オプション）
podman rmi localhost/verified-access-webapp:latest
```

---

## 🔧 トラブルシューティング

### ポート8080が既に使用されている場合

```bash
# 別のポートを使用（例: 8888）
podman run -d --name verified-access-test -p 8888:80 localhost/verified-access-webapp:latest

# アクセス時は8888ポートを使用
curl http://localhost:8888/
```

### コンテナが起動しない場合

```bash
# エラーログを確認
podman logs verified-access-test

# コンテナの詳細情報を確認
podman inspect verified-access-test
```

### ビルド時にエラーが出る場合

```bash
# キャッシュを使わずに再ビルド
podman build --no-cache -t verified-access-webapp:latest .
```

### イメージが見つからない場合

```bash
# すべてのイメージを表示
podman images

# verified-access-webappイメージを再ビルド
cd docker
podman build -t verified-access-webapp:latest .
```

---

## 📚 参考情報

### コンテナのシェルに入る（デバッグ用）

```bash
podman exec -it verified-access-test /bin/sh
# または
docker exec -it verified-access-test /bin/sh
```

**コンテナ内での確認コマンド:**
```bash
# Nginxの設定確認
cat /etc/nginx/conf.d/default.conf

# HTMLファイルの確認
ls -la /usr/share/nginx/html/

# Nginxプロセス確認
ps aux | grep nginx

# 終了
exit
```

### コンテナのリソース使用状況

```bash
podman stats verified-access-test
# または
docker stats verified-access-test
```

---

## 🎯 ローカルテストの目的

1. ✅ **Dockerイメージが正常にビルドできるか確認**
2. ✅ **すべてのHTMLページが正しく配置されているか確認**
3. ✅ **Nginxの設定が正常に動作するか確認**
4. ✅ **ヘルスチェックエンドポイントが機能するか確認**
5. ✅ **ECSデプロイ前に問題を早期発見**

---

**作成日**: 2025-12-07  
**対象**: cdk-verified-access-ecs プロジェクト  
**Docker/Podman**: 両対応

