import { kv } from '@vercel/kv';
import { createClient } from 'redis';
import { Redis } from '@upstash/redis';

// Vercel KV (REST), Upstash veya standart Redis ortam değişkenlerini otomatik tespit eder
async function getKvData(key) {
  // 1. Vercel KV (REST SDK)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return await kv.get(key);
  }
  // 2. Upstash Redis (REST SDK)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const upstash = Redis.fromEnv();
    return await upstash.get(key);
  }
  // 3. Standart REDIS_URL veya KV_URL (TCP Connection)
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (redisUrl) {
    const client = createClient({ url: redisUrl });
    await client.connect();
    const raw = await client.get(key);
    await client.disconnect();
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }
  // Varsayılan kütüphane denemesi
  return await kv.get(key);
}

async function setKvData(key, value) {
  // 1. Vercel KV (REST SDK)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return await kv.set(key, value);
  }
  // 2. Upstash Redis (REST SDK)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const upstash = Redis.fromEnv();
    return await upstash.set(key, value);
  }
  // 3. Standart REDIS_URL veya KV_URL (TCP Connection)
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (redisUrl) {
    const client = createClient({ url: redisUrl });
    await client.connect();
    await client.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
    await client.disconnect();
    return true;
  }
  // Varsayılan kütüphane denemesi
  return await kv.set(key, value);
}

export default async function handler(req, res) {
  // CORS Başlıkları (Frontend ve Vercel Serverless iletişimi için)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const STORAGE_KEY = 'hesap_defteri_data';

  try {
    if (req.method === 'GET') {
      const data = await getKvData(STORAGE_KEY);
      if (!data) {
        return res.status(200).json({
          transactions: [],
          initialBalance: 0,
          categoryRules: [],
          message: "Henüz KV veritabanında kayıtlı veri yok. Varsayılan veri döndürüldü."
        });
      }
      return res.status(200).json(typeof data === 'string' ? JSON.parse(data) : data);
    } 
    
    if (req.method === 'POST') {
      const payload = req.body;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: "Geçersiz JSON verisi." });
      }

      payload.updatedAt = new Date().toISOString();

      await setKvData(STORAGE_KEY, payload);

      return res.status(200).json({
        success: true,
        message: "Veriler Vercel KV / Redis veritabanına başarıyla kaydedildi.",
        updatedAt: payload.updatedAt
      });
    }

    return res.status(405).json({ error: "Yalnızca GET ve POST istekleri desteklenmektedir." });
  } catch (error) {
    console.error("Vercel KV API Error:", error);
    return res.status(500).json({ 
      error: "KV / Redis İşlem Hatası: " + (error.message || "Bilinmeyen hata"),
      hint: "Vercel projenize KV Veritabanını bağladığınızdan emin olun."
    });
  }
}
