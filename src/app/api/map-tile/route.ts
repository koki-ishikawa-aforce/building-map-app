import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    let tileUrl: string | null = null;

    try {
        const { searchParams } = new URL(request.url);
        tileUrl = searchParams.get('url');

        if (!tileUrl) {
            return NextResponse.json({ error: 'Tile URL is required' }, { status: 400 });
        }

        // 国土地理院のタイルを取得
        const response = await fetch(tileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/png,image/*,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch tile: ${response.status}`);
        }

        const imageBuffer = await response.arrayBuffer();

        // 画像レスポンスを返す
        return new NextResponse(imageBuffer, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=3600', // 1時間キャッシュ
                'Access-Control-Allow-Origin': '*',
            },
        });

    } catch (error) {
        console.error('Map tile proxy error:', error);
        console.error('Requested URL:', tileUrl);
        return NextResponse.json({
            error: 'Failed to fetch map tile',
            details: error instanceof Error ? error.message : 'Unknown error',
            url: tileUrl
        }, { status: 500 });
    }
} 