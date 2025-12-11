FROM nginx:alpine

# タイムゾーン設定
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo "Asia/Tokyo" > /etc/timezone && \
    apk del tzdata

# カスタムnginx設定をコピー
COPY nginx.conf /etc/nginx/conf.d/default.conf

# アプリケーションファイルをコピー
COPY app/ /usr/share/nginx/html/

# 権限設定
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

