FROM mcr.microsoft.com/devcontainers/typescript-node:18

# 追加のシステムパッケージをインストール
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        git \
        curl \
        wget \
        vim \
        nano \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

# グローバルnpmパッケージをインストール
RUN npm install -g \
    @types/node \
    typescript \
    eslint \
    prettier \
    nodemon

# 作業ディレクトリを設定
WORKDIR /workspaces/building-map-app

# 環境変数を設定
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# ポートを公開
EXPOSE 3000 3001

# デフォルトコマンド
CMD ["sleep", "infinity"] 