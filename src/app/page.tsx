'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import axios from 'axios';
import * as protobuf from 'protobufjs';

// @ts-ignore: TensorFlow.js型定義
declare module '@tensorflow/tfjs';

// Leafletコンポーネントをdynamic import（ssr: false）で定義
const MapContainer = dynamic(
  () => import('react-leaflet').then(mod => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then(mod => mod.TileLayer),
  { ssr: false }
);
const GeoJSON = dynamic(
  () => import('react-leaflet').then(mod => mod.GeoJSON),
  { ssr: false }
);

const Marker = dynamic(
  () => import('react-leaflet').then(mod => mod.Marker),
  { ssr: false }
);

const Popup = dynamic(
  () => import('react-leaflet').then(mod => mod.Popup),
  { ssr: false }
);


// 型定義
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

interface OverpassResponse {
  elements: Array<{
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    geometry?: Array<{
      lat: number;
      lon: number;
    }>;
  }>;
}

interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    id: number;
    building?: string;
    source?: string;
  };
}

interface BuildingGeoJSON {
  type: 'FeatureCollection';
  features: BuildingFeature[];
}



// メインコンポーネント
const BuildingMapApp = () => {
  const [address, setAddress] = useState('');
  const [center, setCenter] = useState<[number, number]>([35.6762, 139.6503]); // 東京
  const [buildings, setBuildings] = useState<BuildingGeoJSON | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [markerPosition, setMarkerPosition] = useState<[number, number] | null>(null);
  const [markerBuilding, setMarkerBuilding] = useState<BuildingGeoJSON | null>(null);
  const [tfjsLoaded, setTfjsLoaded] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    pixelColor: string;
    buildingPixels: number;
    boundaryPixels: number;
    tileUrl: string;
    markerPosition: string;
    nearbyBuildingPixels: number;
    clustersGenerated: number;
    tileCoordinates: string;
    originalCoordinates: string;
  } | null>(null);

  // 建物色の定義
  const BUILDING_COLORS = {
    // 建物本体の色
    building: [
      { r: 255, g: 230, b: 190 }, // #FFE6BE
      { r: 254, g: 229, b: 189 }, // 少しの誤差を許容
      { r: 255, g: 231, b: 191 },
    ],
    // 建物境界線の色
    boundary: [
      { r: 255, g: 178, b: 128 }, // #FFB280
      { r: 255, g: 212, b: 169 }, // #FFD4A9
      { r: 255, g: 135, b: 75 },  // #FF874B
    ]
  };

  // 色の類似度を計算
  const colorSimilarity = (color1: { r: number, g: number, b: number }, color2: { r: number, g: number, b: number }) => {
    const diff = Math.abs(color1.r - color2.r) +
      Math.abs(color1.g - color2.g) +
      Math.abs(color1.b - color2.b);
    return diff;
  };

  // 建物色かどうかを判定
  const isBuildingColor = (r: number, g: number, b: number, tolerance: number = 50) => {
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
  };

  // ピクセルをクラスタリング
  const clusterPixels = (pixels: Array<[number, number]>, maxDistance: number): Array<Array<[number, number]>> => {
    const clusters: Array<Array<[number, number]>> = [];
    const visited = new Set<string>();

    for (const pixel of pixels) {
      const key = `${pixel[0]},${pixel[1]}`;
      if (visited.has(key)) continue;

      const cluster: Array<[number, number]> = [];
      const queue = [pixel];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentKey = `${current[0]},${current[1]}`;

        if (visited.has(currentKey)) continue;
        visited.add(currentKey);
        cluster.push(current);

        // 近隣ピクセルを探索
        for (const neighbor of pixels) {
          const neighborKey = `${neighbor[0]},${neighbor[1]}`;
          if (visited.has(neighborKey)) continue;

          const distance = Math.sqrt((current[0] - neighbor[0]) ** 2 + (current[1] - neighbor[1]) ** 2);
          if (distance <= maxDistance) {
            queue.push(neighbor);
          }
        }
      }

      if (cluster.length > 0) {
        clusters.push(cluster);
      }
    }

    return clusters;
  };

  // 境界を計算
  const calculateBounds = (pixels: Array<[number, number]>) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const [x, y] of pixels) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    return { minX, minY, maxX, maxY };
  };

  // 境界からポリゴンを生成
  const boundsToPolygon = (bounds: { minX: number, minY: number, maxX: number, maxY: number }): Array<[number, number]> => {
    return [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
      [bounds.minX, bounds.minY] // 閉じる
    ];
  };

  // 地図タイルの色分析による建物検出
  const detectBuildingsByColor = async (lat: number, lon: number): Promise<BuildingGeoJSON | null> => {
    try {
      console.log('Starting color-based building detection...');

      // タイル座標計算（修正版）
      const zoom = 18;
      const n = Math.pow(2, zoom);
      const tileX = Math.floor((lon + 180) / 360 * n);
      const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const tileUrl = `https://cyberjapandata.gsi.go.jp/xyz/std/${zoom}/${tileX}/${tileY}.png`;

      console.log('Tile coordinates:', { tileX, tileY, zoom, n });
      console.log('Fetching tile:', tileUrl);

      // 画像取得
      const response = await axios.get(tileUrl, { responseType: 'arraybuffer' });
      const blob = new Blob([response.data]);
      const img = new window.Image();
      const url = URL.createObjectURL(blob);

      // 画像ロードPromise
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      console.log('Image loaded, analyzing colors...');

      // Canvasへ描画
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);

      // ピクセルデータを取得
      const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
      if (!imageData) {
        console.error('Failed to get image data');
        return null;
      }

      // 建物ピクセルを検出
      const buildingPixels: Array<[number, number]> = [];
      const boundaryPixels: Array<[number, number]> = [];

      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          const index = (y * imageData.width + x) * 4;
          const r = imageData.data[index];
          const g = imageData.data[index + 1];
          const b = imageData.data[index + 2];

          const colorType = isBuildingColor(r, g, b);
          if (colorType === 'building') {
            buildingPixels.push([x, y]);
          } else if (colorType === 'boundary') {
            boundaryPixels.push([x, y]);
          }
        }
      }

      console.log(`Found ${buildingPixels.length} building pixels, ${boundaryPixels.length} boundary pixels`);

      // ピン位置のピクセル座標（修正版）
      const pixelX = Math.floor(((lon + 180) / 360 * n - tileX) * 256);
      const pixelY = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileY) * 256);

      console.log('Marker pixel position:', pixelX, pixelY);

      // ピクセル座標の範囲チェック
      if (pixelX < 0 || pixelX >= imageData.width || pixelY < 0 || pixelY >= imageData.height) {
        console.error('Marker pixel position out of bounds:', { pixelX, pixelY, width: imageData.width, height: imageData.height });
        return null;
      }

      // ピン位置の色を取得
      const markerIndex = (pixelY * imageData.width + pixelX) * 4;
      const markerR = imageData.data[markerIndex];
      const markerG = imageData.data[markerIndex + 1];
      const markerB = imageData.data[markerIndex + 2];
      const markerColor = `#${markerR.toString(16).padStart(2, '0')}${markerG.toString(16).padStart(2, '0')}${markerB.toString(16).padStart(2, '0')}`;

      console.log('Marker pixel color:', markerColor, `RGB(${markerR}, ${markerG}, ${markerB})`);

      // デバッグ情報を設定
      setDebugInfo({
        pixelColor: markerColor,
        buildingPixels: buildingPixels.length,
        boundaryPixels: boundaryPixels.length,
        tileUrl: tileUrl,
        markerPosition: `${pixelX}, ${pixelY}`,
        nearbyBuildingPixels: 0, // 後で更新
        clustersGenerated: 0, // 後で更新
        tileCoordinates: `${tileX}, ${tileY}`,
        originalCoordinates: `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      });

      // ピン位置周辺の建物領域を検出（検索範囲を拡大）
      const markerRadius = 30; // ピクセル単位（狭める）
      const nearbyBuildingPixels = buildingPixels.filter(([x, y]) => {
        const distance = Math.sqrt((x - pixelX) ** 2 + (y - pixelY) ** 2);
        return distance <= markerRadius;
      });

      console.log(`Found ${nearbyBuildingPixels.length} building pixels within ${markerRadius}px of marker`);

      // デバッグ情報を更新
      setDebugInfo(prev => prev ? {
        ...prev,
        nearbyBuildingPixels: nearbyBuildingPixels.length
      } : null);

      if (nearbyBuildingPixels.length === 0) {
        console.log('No building pixels found near marker');
        return null;
      }

      // 建物ピクセルをクラスタリングしてポリゴン生成（距離を調整）
      const clusters = clusterPixels(nearbyBuildingPixels, 3); // 3ピクセル以内を同じクラスタ

      console.log(`Generated ${clusters.length} clusters from nearby building pixels`);

      // デバッグ情報を更新
      setDebugInfo(prev => prev ? {
        ...prev,
        clustersGenerated: clusters.length
      } : null);

      // 各クラスタからポリゴンを生成
      const polygons: number[][][] = [];

      for (const cluster of clusters) {
        if (cluster.length < 5) continue; // 最小クラスタサイズを5に変更

        // クラスタの境界を計算
        const bounds = calculateBounds(cluster);
        const polygon = boundsToPolygon(bounds);

        // 地理座標に変換（修正版）
        const geoPolygon = polygon.map(([x, y]) => {
          // ピクセル座標から地理座標への正しい変換
          const pixelLon = (tileX * 256 + x) / (n * 256) * 360 - 180;
          const pixelLat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY * 256 + y) / (n * 256))));

          // デバッグ: 座標変換の詳細を確認
          console.log(`Pixel (${x}, ${y}) -> Geo (${pixelLon.toFixed(6)}, ${pixelLat.toFixed(6)})`);

          return [pixelLon, pixelLat];
        });

        // デバッグ: 元のピクセル座標と変換後の地理座標を比較
        console.log('Original pixel bounds:', bounds);
        console.log('Converted geo bounds:', {
          minLon: Math.min(...geoPolygon.map(p => p[0])),
          maxLon: Math.max(...geoPolygon.map(p => p[0])),
          minLat: Math.min(...geoPolygon.map(p => p[1])),
          maxLat: Math.max(...geoPolygon.map(p => p[1]))
        });

        polygons.push(geoPolygon);
      }

      console.log(`Generated ${polygons.length} building polygons`);

      // デバッグ: 最初のポリゴンの座標を確認
      if (polygons.length > 0) {
        console.log('First polygon coordinates:', polygons[0]);
        console.log('First polygon bounds:', {
          minLon: Math.min(...polygons[0].map(p => p[0])),
          maxLon: Math.max(...polygons[0].map(p => p[0])),
          minLat: Math.min(...polygons[0].map(p => p[1])),
          maxLat: Math.max(...polygons[0].map(p => p[1]))
        });
      }

      // GeoJSON返却
      return {
        type: 'FeatureCollection',
        features: polygons.map((coordinates, index) => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
          properties: {
            id: index + 1,
            building: 'color_detected',
            source: 'color_analysis',
            pixelCount: clusters[index]?.length || 0
          }
        }))
      };

    } catch (error) {
      console.error('Color-based building detection error:', error);
      return null;
    }
  };

  // TensorFlow.jsを動的に読み込む関数
  const loadTensorFlow = async (): Promise<void> => {
    if (typeof window === 'undefined') return;

    try {
      console.log('Loading TensorFlow.js...');
      const tf = await import('@tensorflow/tfjs') as any;
      await tf.ready();
      console.log('TensorFlow.js loaded successfully');
      setTfjsLoaded(true);
    } catch (error) {
      console.error('TensorFlow.js loading error:', error);
    }
  };

  // クライアントサイドでのみ実行
  useEffect(() => {
    setIsClient(true);

    // Leafletアイコンの設定
    import('leaflet').then((L) => {
      // デフォルトアイコンの設定
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
    });

    // TensorFlow.jsを動的に読み込み
    loadTensorFlow();
  }, []);

  // 住所から緯度経度を取得
  const handleGeocode = async (searchAddress: string): Promise<[number, number] | null> => {
    try {
      console.log('Geocoding address:', searchAddress);

      // 複数の検索パターンを試す
      const searchPatterns = [
        searchAddress,
        searchAddress.replace(/[0-9-]/g, '').trim(), // 数字とハイフンを除去
        searchAddress.split(' ').slice(0, 3).join(' '), // 最初の3つの部分のみ
        searchAddress.split('区')[0] + '区', // 区まで
        searchAddress.split('市')[0] + '市' // 市まで
      ];

      for (const pattern of searchPatterns) {
        if (!pattern.trim()) continue;

        console.log('Trying pattern:', pattern);

        const response = await axios.get<GoogleGeocodingResponse>(
          `https://maps.googleapis.com/maps/api/geocode/json`,
          {
            params: {
              address: pattern,
              key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'YOUR_API_KEY' // 環境変数からAPIキーを取得
            }
          }
        );

        console.log('Google Maps Geocoding response for pattern:', pattern, response.data);

        if (response.data.status === 'OK' && response.data.results.length > 0) {
          const result = response.data.results[0];
          const { lat, lng } = result.geometry.location;
          console.log('Found coordinates:', lat, lng, 'for:', result.formatted_address);
          return [lat, lng];
        }
      }

      console.log('No results found for any pattern');

      // フォールバック: 有名な場所の座標を使用
      const fallbackCoordinates: Record<string, [number, number]> = {
        '渋谷': [35.658034, 139.701636],
        '新宿': [35.689521, 139.691704],
        '池袋': [35.729503, 139.710900],
        '東京': [35.6762, 139.6503],
        '銀座': [35.671946, 139.763965],
        '秋葉原': [35.698683, 139.774219],
        '原宿': [35.670168, 139.701636],
        '表参道': [35.665428, 139.712160]
      };

      // 入力された住所に含まれるキーワードでフォールバック座標を探す
      for (const [keyword, coords] of Object.entries(fallbackCoordinates)) {
        if (searchAddress.includes(keyword)) {
          console.log('Using fallback coordinates for:', keyword, coords);
          return coords;
        }
      }

      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  // 国土地理院の建物データを取得
  const fetchGSIBuildings = async (lat: number, lon: number): Promise<BuildingGeoJSON | null> => {
    try {
      console.log('Fetching GSI building data for:', lat, lon);

      // 国土地理院の建物データAPI（ベクトルタイル）
      const zoom = 18;
      const tileX = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
      const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

      // 国土地理院の建物データAPI（正しいエンドポイント）
      const buildingUrl = `https://cyberjapandata.gsi.go.jp/xyz/building/${zoom}/${tileX}/${tileY}.pbf`;

      console.log('GSI building URL:', buildingUrl);

      // ベクトルタイルの取得（PBF形式）
      const response = await axios.get(buildingUrl, {
        responseType: 'arraybuffer',
        timeout: 10000, // 10秒タイムアウト
        validateStatus: (status) => status < 500 // 404も含めてエラーとして扱わない
      });

      // 404エラーの場合は建物データが存在しない
      if (response.status === 404) {
        console.log('GSI building data not available for this area');
        return null;
      }

      console.log('GSI building response received, status:', response.status);

      // PBFファイルの解析（簡易版）
      // 実際の実装では、protobufライブラリを使用してベクトルタイルを解析
      // ここでは簡易的に建物データがあることを示すダミーデータを返す

      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [lon - 0.001, lat - 0.001],
                [lon + 0.001, lat - 0.001],
                [lon + 0.001, lat + 0.001],
                [lon - 0.001, lat + 0.001],
                [lon - 0.001, lat - 0.001]
              ]]
            },
            properties: {
              id: 1,
              building: 'gsi_building',
              source: 'GSI'
            }
          }
        ]
      };

    } catch (error) {
      console.error('GSI building data error:', error);
      return null;
    }
  };

  // 建物ポリゴンを取得（Overpass API + 国土地理院）
  const fetchBuildings = async (lat: number, lon: number): Promise<BuildingGeoJSON | null> => {
    try {
      const radius = 0.005; // 約500mに拡大
      const query = `
        [out:json][timeout:25];
        (
          way["building"](around:${radius},${lat},${lon});
          relation["building"](around:${radius},${lat},${lon});
        );
        out body;
        >;
        out skel qt;
      `;

      // Overpass APIから建物データを取得
      const response = await axios.get(`https://overpass-api.de/api/interpreter`, {
        params: { data: query },
        timeout: 30000
      });

      if (response.data.elements && response.data.elements.length > 0) {
        // 建物データをGeoJSON形式に変換
        const features: BuildingFeature[] = response.data.elements
          .filter((element: any) => element.type === 'way' && element.geometry)
          .map((element: any, index: number) => ({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [element.geometry.map((point: any) => [point.lon, point.lat])]
            },
            properties: {
              id: element.id,
              building: element.tags?.building || 'unknown',
              source: 'OpenStreetMap'
            }
          }));

        return {
          type: 'FeatureCollection',
          features
        };
      }

      // Overpass APIでデータが見つからない場合は、色分析による検出を試行
      console.log('No OSM building data found, trying color-based detection...');
      return await detectBuildingsByColor(lat, lon);

    } catch (error) {
      console.error('Building fetch error:', error);

      // エラーが発生した場合は、色分析による検出を試行
      console.log('Falling back to color-based detection...');
      return await detectBuildingsByColor(lat, lon);
    }
  };
};
export default BuildingMapApp;