This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Option 1: Dev Container (推奨)

VS Code Dev Containersを使用して開発環境を構築する方法：

1. **VS Code Dev Containers拡張機能をインストール**
   - VS Codeで拡張機能「Dev Containers」をインストール

2. **Dev Containerで開く**
   - VS Codeでこのプロジェクトを開く
   - `Ctrl+Shift+P` → 「Dev Containers: Reopen in Container」を選択
   - コンテナのビルドが完了するまで待つ

3. **環境変数の設定**
   ```bash
   # .env.localファイルを作成
   cp .env.local.example .env.local
   # エディタで.env.localを開いてAPIキーを設定
   ```

4. **開発サーバーの起動**
   - コンテナ内で自動的に`npm run dev`が実行されます
   - ブラウザで http://localhost:3000 にアクセス

### Option 2: ローカル環境

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
