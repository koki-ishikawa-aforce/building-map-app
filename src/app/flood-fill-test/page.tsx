'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';

interface Point {
  x: number;
  y: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Google Maps Geocoding APIの型定義
interface GoogleGeocodingResponse {
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    formatted_address: string;
  }>;
  status: string;
}

const FloodFillTestPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fillColor, setFillColor] = useState<string>('#ff0000');
  const [tolerance, setTolerance] = useState<number>(30);
  const [status, setStatus] = useState<string>('住所を検索して建物をFlood Fillしてください');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [address, setAddress] = useState<string>('');
  const [center, setCenter] = useState<[number, number]>([35.6762, 139.6503]); // 東京
  const [mapKey, setMapKey] = useState(0);
  const [markerPosition, setMarkerPosition] = useState<[number, number] | null>(null);

  // 建物色の定義（国土地理院地図用）
  const BUILDING_COLORS = {
    // 建物本体の色（国土地理院の建物色）
    building: [
      { r: 255, g: 230, b: 190 }, // #FFE6BE - 標準的な建物色
      { r: 254, g: 229, b: 189 }, // 少しの誤差を許容
      { r: 255, g: 231, b: 191 },
      { r: 255, g: 235, b: 205 }, // より明るい建物色
      { r: 255, g: 225, b: 185 }, // より暗い建物色
      { r: 255, g: 240, b: 210 }, // さらに明るい建物色
      { r: 255, g: 220, b: 180 }, // さらに暗い建物色
    ],
    // 建物境界線の色
    boundary: [
      { r: 255, g: 178, b: 128 }, // #FFB280
      { r: 255, g: 212, b: 169 }, // #FFD4A9
      { r: 255, g: 135, b: 75 },  // #FF874B
      { r: 255, g: 165, b: 115 }, // 中間的な境界線色
      { r: 255, g: 190, b: 140 }, // 明るい境界線色
      { r: 255, g: 150, b: 100 }, // 暗い境界線色
    ]
  };

  // 色の類似度を計算（既存地図ページと同じ）
  const colorSimilarity = useCallback((color1: {r: number, g: number, b: number}, color2: {r: number, g: number, b: number}) => {
    const diff = Math.abs(color1.r - color2.r) + 
                 Math.abs(color1.g - color2.g) + 
                 Math.abs(color1.b - color2.b);
    return diff;
  }, []);

  // 建物色かどうかを判定（既存地図ページと同じ）
  const isBuildingColor = useCallback((r: number, g: number, b: number, tolerance: number = 50) => {
    const color = { r, g, b };
    
    // 建物本体の色かチェック
    for (const buildingColor of BUILDING_COLORS.building) {
      if (colorSimilarity(color, buildingColor) <= tolerance) {
        return 'building';
      }
    }
    
    // 建物境界線の色かチェック
    for (const boundaryColor of BUILDING_COLORS.boundary) {
      if (colorSimilarity(color, boundaryColor) <= tolerance) {
        return 'boundary';
      }
    }
    
    return 'none';
  }, [colorSimilarity]);

  // 色の類似性を判定する関数
  const isSimilarColor = useCallback((color1: Color, color2: Color, tolerance: number): boolean => {
    const diff = Math.sqrt(
      Math.pow(color1.r - color2.r, 2) +
      Math.pow(color1.g - color2.g, 2) +
      Math.pow(color1.b - color2.b, 2)
    );
    return diff <= tolerance;
  }, []);

  // 住所から緯度経度を取得
  const handleGeocode = useCallback(async (searchAddress: string): Promise<[number, number] | null> => {
    try {
      const response = await axios.get<GoogleGeocodingResponse>(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchAddress)}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
      );

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return [location.lat, location.lng];
      } else {
        setStatus('住所が見つかりませんでした。');
        return null;
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      setStatus('住所の検索中にエラーが発生しました。');
      return null;
    }
  }, []);

  // Flood Fillアルゴリズム（スタックベース）
  const floodFill = useCallback((
    imageData: ImageData,
    startX: number,
    startY: number,
    targetColor: Color,
    fillColor: Color,
    tolerance: number
  ): number => {
    const { width, height, data } = imageData;
    const stack: Point[] = [{ x: startX, y: startY }];
    let processedPixels = 0;

    // 開始点の色を取得
    const startIndex = (startY * width + startX) * 4;
    const startColor: Color = {
      r: data[startIndex],
      g: data[startIndex + 1],
      b: data[startIndex + 2],
      a: data[startIndex + 3]
    };

    // 開始色と塗りつぶし色が同じ場合は処理をスキップ
    if (startColor.r === fillColor.r && 
        startColor.g === fillColor.g && 
        startColor.b === fillColor.b) {
      return 0;
    }

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      
      // 境界チェック
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }

      const index = (y * width + x) * 4;
      const currentColor: Color = {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2],
        a: data[index + 3]
      };

      // 色が類似していない場合はスキップ
      if (!isSimilarColor(currentColor, startColor, tolerance)) {
        continue;
      }

      // 既に塗りつぶし色の場合はスキップ
      if (currentColor.r === fillColor.r && 
          currentColor.g === fillColor.g && 
          currentColor.b === fillColor.b) {
        continue;
      }

      // ピクセルを塗りつぶし色で更新
      data[index] = fillColor.r;
      data[index + 1] = fillColor.g;
      data[index + 2] = fillColor.b;
      data[index + 3] = fillColor.a;
      processedPixels++;

      // 隣接ピクセルをスタックに追加
      stack.push({ x: x + 1, y });
      stack.push({ x: x - 1, y });
      stack.push({ x, y: y + 1 });
      stack.push({ x, y: y - 1 });
    }

    return processedPixels;
  }, [isSimilarColor]);

  // 塗りつぶし色を16進数からRGBに変換
  const hexToRgb = useCallback((hex: string): Color => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 255
    } : { r: 255, g: 0, b: 0, a: 255 };
  }, []);


  // 国土地理院の地図タイルを描画
  const drawMapTile = useCallback(async (ctx: CanvasRenderingContext2D, lat: number, lon: number) => {
    const { width, height } = ctx.canvas;
    
    console.log('Drawing map tiles for:', { lat, lon, width, height });
    
    // 背景を白で塗りつぶし
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    try {
      // タイル座標計算（src/app/page.tsxと同じ方法）
      const zoom = 18; // 適度なズームレベル
      const tileSize = 256;
      const n = Math.pow(2, zoom);
      const tileX = Math.floor((lon + 180) / 360 * n);
      const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);

      // 表示するタイルの範囲を計算
      const tilesX = Math.ceil(width / tileSize) + 1;
      const tilesY = Math.ceil(height / tileSize) + 1;

      console.log('Tile coordinates:', { tileX, tileY, tilesX, tilesY });
      
      // 複数のタイルを描画
      for (let x = 0; x < tilesX; x++) {
        for (let y = 0; y < tilesY; y++) {
          const currentTileX = tileX + x;
          const currentTileY = tileY + y;

          // 国土地理院のタイルURL（正しいURL）
          const tileUrl = `https://cyberjapandata.gsi.go.jp/xyz/std/${zoom}/${currentTileX}/${currentTileY}.png`;
          console.log('Loading tile:', { x, y, currentTileX, currentTileY, tileUrl });

          try {
            // タイル画像を読み込み（CORS対応）
            const img = new Image();
            
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              // 直接国土地理院のタイルを読み込み
              img.src = `/api/map-tile?url=${encodeURIComponent(tileUrl)}`;
            });

            // タイルをCanvasに描画
            const drawX = x * tileSize;
            const drawY = y * tileSize;
            ctx.drawImage(img, drawX, drawY, tileSize, tileSize);

          } catch (error) {
            console.warn(`Failed to load tile: ${tileUrl}`, error);
            // タイル読み込み失敗時はグレーの背景を描画
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            
            // エラー情報を詳細にログ出力
            if (error instanceof Error) {
              console.error('Tile loading error details:', {
                url: tileUrl,
                error: error.message,
                stack: error.stack
              });
            }
          }
        }
      }

    } catch (error) {
      console.error('Error loading map tiles:', error);
      // エラー時はシンプルな背景を描画
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, width, height);
      
      // エラーメッセージを表示
      ctx.fillStyle = '#666666';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('地図の読み込みに失敗しました', width / 2, height / 2);
    }
  }, []);

  // ピンをcanvas上に描画する関数
  const drawMarker = useCallback((ctx: CanvasRenderingContext2D, lat: number, lon: number) => {
    // 地図中心の緯度経度
    const zoom = 18;
    const tileSize = 256;
    const n = Math.pow(2, zoom);
    const tileX = Math.floor((lon + 180) / 360 * n);
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    // canvasの中心を地図中心に合わせている前提
    // 1タイル分だけ描画している場合はcanvas中心がcenter
    // ここではcanvasの中心にピンを描画
    const canvas = ctx.canvas;
    const x = canvas.width / 2;
    const y = canvas.height / 2;
    // ピン描画
    ctx.save();
    // 影
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();
    // 白縁
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // 赤丸
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#e11d48';
    ctx.fill();
    // 十字
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.restore();
  }, []);

  // drawMapTileの後にピンを描画
  const drawMapTileWithMarker = useCallback(async (ctx: CanvasRenderingContext2D, lat: number, lon: number) => {
    await drawMapTile(ctx, lat, lon);
    if (markerPosition) {
      // markerPositionの緯度経度をcanvas座標に変換
      // 地図中心lat/lon→canvas中心、ズーム18, 1タイル分表示前提
      const zoom = 18;
      const tileSize = 256;
      const n = Math.pow(2, zoom);
      const centerTileX = Math.floor((lon + 180) / 360 * n);
      const centerTileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const [markerLat, markerLon] = markerPosition;
      const markerTileX = Math.floor((markerLon + 180) / 360 * n);
      const markerTileY = Math.floor((1 - Math.log(Math.tan(markerLat * Math.PI / 180) + 1 / Math.cos(markerLat * Math.PI / 180)) / Math.PI) / 2 * n);
      // タイル内ピクセル座標
      const markerPixelX = Math.floor(((markerLon + 180) / 360 * n - markerTileX) * tileSize);
      const markerPixelY = Math.floor(((1 - Math.log(Math.tan(markerLat * Math.PI / 180) + 1 / Math.cos(markerLat * Math.PI / 180)) / Math.PI) / 2 * n - markerTileY) * tileSize);
      // canvas中心からのオフセット
      const dx = (markerTileX - centerTileX) * tileSize + (markerPixelX - tileSize / 2);
      const dy = (markerTileY - centerTileY) * tileSize + (markerPixelY - tileSize / 2);
      const x = ctx.canvas.width / 2 + dx;
      const y = ctx.canvas.height / 2 + dy;
      // ピン描画
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#e11d48';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
      ctx.restore();
    }
  }, [drawMapTile, markerPosition]);

  // 地図タイルから建物色を検出してFlood Fill実行
  const detectAndFloodFill = useCallback(async (lat: number, lon: number) => {
    try {
      setIsProcessing(true);
      setStatus('地図タイルを分析中...');
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // ここで地図描画はしない（useEffectで描画される）
      // 指定座標のピクセル色を取得
      // center/markerPositionが更新された後にcanvasが描画されている前提
      // markerPositionがnullの場合はcenterを使う
      const [latToUse, lonToUse] = markerPosition || center;
      // タイル座標計算（src/app/page.tsxと同じ方法）
      const zoom = 19;
      const tileSize = 256;
      const n = Math.pow(2, zoom);
      const tileX = Math.floor((lonToUse + 180) / 360 * n);
      const tileY = Math.floor((1 - Math.log(Math.tan(latToUse * Math.PI / 180) + 1 / Math.cos(latToUse * Math.PI / 180)) / Math.PI) / 2 * n);
      const pixelX = Math.floor(((lonToUse + 180) / 360 * n - tileX) * tileSize);
      const pixelY = Math.floor(((1 - Math.log(Math.tan(latToUse * Math.PI / 180) + 1 / Math.cos(latToUse * Math.PI / 180)) / Math.PI) / 2 * n - tileY) * tileSize);
      // 指定座標のピクセル色を取得
      const imageData = ctx.getImageData(pixelX, pixelY, 1, 1);
      const clickedColor = {
        r: imageData.data[0],
        g: imageData.data[1],
        b: imageData.data[2],
        a: imageData.data[3]
      };
      // 建物色かどうかを判定
      const buildingType = isBuildingColor(clickedColor.r, clickedColor.g, clickedColor.b, tolerance);
      if (buildingType === 'none') {
        setStatus('指定された座標は建物ではありません。');
        setIsProcessing(false);
        return;
      }
      setStatus('建物を検出しました。Flood Fillを実行中...');
      // 塗りつぶし色を取得
      const fillColorRgb = hexToRgb(fillColor);
      // 全体のピクセルデータを取得
      const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Flood Fillを実行
      const processedPixels = floodFill(fullImageData, pixelX, pixelY, { r: 0, g: 0, b: 0, a: 0 }, fillColorRgb, tolerance);
      // 結果をCanvasに反映
      ctx.putImageData(fullImageData, 0, 0);
      setIsProcessing(false);
      setStatus(`建物を検出し、${processedPixels}ピクセルを塗りつぶしました（tolerance: ${tolerance}）`);
    } catch (error) {
      console.error('Flood Fill error:', error);
      setStatus('Flood Fill処理中にエラーが発生しました。');
      setIsProcessing(false);
    }
  }, [fillColor, tolerance, floodFill, hexToRgb, isBuildingColor, markerPosition, center]);

  // 住所検索とFlood Fill実行
  const handleSearch = useCallback(async () => {
    if (!address.trim()) {
      setStatus('住所を入力してください。');
      return;
    }
    setStatus('住所を検索中...');
    const coordinates = await handleGeocode(address);
    if (coordinates) {
      const [lat, lon] = coordinates;
      setCenter([lat, lon]);
      setMapKey(prev => prev + 1);
      setMarkerPosition([lat, lon]); // 検索結果をマーカーとしてセット
      // 地図描画やFloodFillはuseEffectに任せる
    }
  }, [address, handleGeocode]);

  // キーボードイベントハンドラー
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }, [handleSearch]);

  // 初期描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvasサイズを設定
    canvas.width = 800;
    canvas.height = 600;

    // 初期地図を描画（非同期）
    drawMapTileWithMarker(ctx, center[0], center[1]).catch(error => {
      console.error('Error loading initial map:', error);
    });
  }, [drawMapTileWithMarker, center]);

  // markerPositionやcenterが変化したときもcanvasを再描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawMapTileWithMarker(ctx, center[0], center[1]);
  }, [center, markerPosition, drawMapTileWithMarker]);


  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8 text-center">
          🗺️ 国土地理院地図 Flood Fill 実験ページ
        </h1>
        <p className="text-sm text-gray-600 text-center mb-4">
          地図データ: 国土地理院（https://maps.gsi.go.jp/）© 国土地理院
        </p>
        
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* 住所検索エリア */}
            <div className="flex-1">
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="住所を入力してください（例：東京都渋谷区）"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isProcessing}
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isProcessing}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    検索
                  </button>
                </div>
              </div>
              
              {/* 地図表示エリア */}
              <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
                <canvas
                  ref={canvasRef}
                  className="w-full h-auto"
                  style={{ maxHeight: '600px' }}
                  tabIndex={0}
                  aria-label="地図表示エリア"
                />
              </div>
            </div>

            {/* コントロールパネル */}
            <div className="lg:w-80 space-y-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">
                  設定
                </h3>
                
                {/* 塗りつぶし色選択 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    塗りつぶし色
                  </label>
                  <input
                    type="color"
                    value={fillColor}
                    onChange={(e) => setFillColor(e.target.value)}
                    className="w-full h-10 rounded border border-gray-300 cursor-pointer"
                    disabled={isProcessing}
                  />
                </div>

                {/* Tolerance設定 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tolerance: {tolerance}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    disabled={isProcessing}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0</span>
                    <span>50</span>
                    <span>100</span>
                  </div>
                </div>

                                {/* 座標表示 */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    現在の座標
                  </label>
                  <div className="text-sm text-gray-600 bg-gray-100 p-2 rounded">
                    <div>緯度: {center[0].toFixed(6)}</div>
                    <div>経度: {center[1].toFixed(6)}</div>
                  </div>
                </div>
              </div>

              {/* ステータス表示 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  ステータス
                </h3>
                <div className="text-sm text-gray-600">
                  {isProcessing ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                      処理中...
                    </div>
                  ) : (
                    <p>{status}</p>
                  )}
                </div>
              </div>

                            {/* 地図凡例 */}
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-green-700 mb-2">
                  🗺️ 国土地理院地図凡例
                </h3>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#FFE6BE] mr-2"></div>
                      <span>建物</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#FFB280] mr-2"></div>
                      <span>建物境界</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#228b22] mr-2"></div>
                      <span>公園・緑地</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#4169e1] mr-2"></div>
                      <span>水域</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#696969] mr-2"></div>
                      <span>道路</span>
                    </div>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-[#ffffff] mr-2 border border-gray-300"></div>
                      <span>その他</span>
                    </div>
                  </div>
              </div>

              {/* 使い方説明 */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-blue-700 mb-2">
                  💡 使い方
                </h3>
                                 <ul className="text-sm text-blue-600 space-y-1">
                   <li>• 住所を入力して検索</li>
                   <li>• 指定座標が建物の場合、Flood Fill実行</li>
                   <li>• Tolerance値を調整して建物判定の感度を制御</li>
                   <li>• 塗りつぶし色を変更して視覚効果を確認</li>
                 </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloodFillTestPage; 