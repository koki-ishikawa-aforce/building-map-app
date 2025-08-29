import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker対応のための設定
  output: 'standalone',

  // 画像最適化の設定
  images: {
    unoptimized: true,
  },

  // その他の設定
  experimental: {
    // 必要に応じて実験的機能を有効化
  },
};

export default nextConfig;
