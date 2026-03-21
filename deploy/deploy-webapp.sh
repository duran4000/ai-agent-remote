#!/bin/bash

# 部署Web App到远程服务器
# 用法: ./deploy-webapp.sh
# 注意：需要在WSL环境中运行

# 读取 .env 文件
ENV_FILE="$(dirname "$0")/../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "错误: 找不到 .env 文件"
    echo "请复制 .env.example 为 .env 并填入实际凭证"
    exit 1
fi

# 加载 .env 文件
export $(grep -v '^#' "$ENV_FILE" | xargs)

SERVER="${SERVER_USER}@${SERVER_HOST}"
REMOTE_DIR="${SERVER_PATH}/server/webapp"
LOCAL_DIR="${LOCAL_PROJECT_PATH}/server/webapp"

echo "开始部署 Web App..."

# 部署HTML
echo "部署 index.html..."
sshpass -p "${SERVER_PASSWORD}" scp $LOCAL_DIR/index.html $SERVER:$REMOTE_DIR/

# 部署CSS
echo "部署 CSS..."
sshpass -p "${SERVER_PASSWORD}" scp $LOCAL_DIR/css/*.css $SERVER:$REMOTE_DIR/css/

# 部署JS
echo "部署 JavaScript..."
sshpass -p "${SERVER_PASSWORD}" scp $LOCAL_DIR/js/*.js $SERVER:$REMOTE_DIR/js/

echo "Web App 部署完成！"
echo "请刷新浏览器查看更新"
