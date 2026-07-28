export default async function handler(req, res) {
  // CORS Başlıkları
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Sadece POST isteği desteklenir." });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const { pdfText, provider = 'groq', apiKey } = body || {};

    if (!pdfText || typeof pdfText !== 'string' || pdfText.trim().length === 0) {
      return res.status(400).json({ error: "PDF metni boş veya okunamadı." });
    }

    const DEFAULT_GROQ_KEY = "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";
    let effectiveKey = apiKey ? String(apiKey).trim() : "";

    if (!effectiveKey) {
      if (provider === "groq") {
        effectiveKey = process.env.GROQ_API_KEY || DEFAULT_GROQ_KEY;
      } else if (provider === "gemini") {
        effectiveKey = process.env.GEMINI_API_KEY || "";
      }
    }

    if (!effectiveKey) {
      return res.status(400).json({ error: "API Key bulunamadı. Lütfen bir API Key girin." });
    }

    const promptText = `
Sen bir kredi kartı ve banka ekstresi analiz uzmanısın.
Sana verilen ekstre metnini incele ve harcama/gelir kalemlerini JSON formatında döndür.

ÇIKTI FORMATI:
SADECE geçerli bir JSON array (dizi) döndür. Başka hiçbir açıklama, markdown veya metin YAZMA.
Her eleman şu objelerden oluşmalı:
[
  {
    "date": "YYYY-MM-DD",
    "description": "İşlem Açıklaması veya Firma Adı",
    "amount": 123.45,
    "type": "gider" veya "gelir"
  }
]

ÖNEMLİ KURALLAR:
1. Tarihleri YYYY-MM-DD formatına çevir (Örn: 15.04.2024 -> 2024-04-15). Yıl yoksa içinde bulunduğumuz yılı varsay.
2. Tutar pozitif sayı olmalı (Örn: 150.50).
3. Normal harcamalar "gider", ödemeler veya iadeler "gelir" olmalı.
4. Toplam tutarlar, dönem içi harcama özetleri, kart numaraları gibi işlemleri DAHİL ETME, sadece bireysel harcama satırlarını al.

ANALİZ EDİLECEK EKSTRE METNİ:
${pdfText.slice(0, 15000)}
`;

    let rawOutput = '';

    if (provider === 'groq') {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: promptText }],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        return res.status(400).json({ error: `Groq API Hatası (${response.status}): ${errJson.error?.message || 'Bilinmeyen hata'}` });
      }

      const data = await response.json();
      rawOutput = data.choices?.[0]?.message?.content || '';
    } else if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${effectiveKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        return res.status(400).json({ error: `Gemini API Hatası (${response.status}): ${errJson.error?.message || 'Bilinmeyen hata'}` });
      }

      const data = await response.json();
      rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: promptText }],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        return res.status(400).json({ error: `OpenAI API Hatası (${response.status}): ${errJson.error?.message || 'Bilinmeyen hata'}` });
      }

      const data = await response.json();
      rawOutput = data.choices?.[0]?.message?.content || '';
    } else if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-001',
          messages: [{ role: 'user', content: promptText }]
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        return res.status(400).json({ error: `OpenRouter API Hatası (${response.status}): ${errJson.error?.message || 'Bilinmeyen hata'}` });
      }

      const data = await response.json();
      rawOutput = data.choices?.[0]?.message?.content || '';
    }

    let parsedTransactions = [];
    try {
      const cleanJsonStr = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonObj = JSON.parse(cleanJsonStr);
      if (Array.isArray(jsonObj)) {
        parsedTransactions = jsonObj;
      } else if (jsonObj && Array.isArray(jsonObj.transactions)) {
        parsedTransactions = jsonObj.transactions;
      } else if (jsonObj && Array.isArray(jsonObj.items)) {
        parsedTransactions = jsonObj.items;
      } else if (jsonObj && typeof jsonObj === 'object') {
        const possibleArr = Object.values(jsonObj).find(val => Array.isArray(val));
        if (possibleArr) parsedTransactions = possibleArr;
      }
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw output:", rawOutput);
      return res.status(400).json({ error: "Yapay zeka yanıtı geçerli bir JSON listesine dönüştürülemedi.", rawOutput });
    }

    return res.status(200).json({
      success: true,
      provider,
      count: parsedTransactions.length,
      transactions: parsedTransactions
    });

  } catch (error) {
    console.error("PDF analysis server error:", error);
    return res.status(400).json({ error: "Sunucu içi analiz hatası: " + (error.message || "Bilinmeyen hata") });
  }
}
