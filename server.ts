import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "20mb" }));

  // Sağlık Kontrolü
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vercel KV Veri Senkronizasyonu & Yerel Bellek Fallback
  let memoryKvData: any = null;
  app.get("/api/veri", async (req, res) => {
    try {
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        const { kv } = await import('@vercel/kv');
        const data = await kv.get('hesap_defteri_data');
        if (data) return res.json(data);
      }
      if (memoryKvData) return res.json(memoryKvData);
      return res.json({ transactions: [], initialBalance: 0, categoryRules: [] });
    } catch (e: any) {
      if (memoryKvData) return res.json(memoryKvData);
      return res.json({ transactions: [], initialBalance: 0, categoryRules: [] });
    }
  });

  app.post("/api/veri", async (req, res) => {
    try {
      const payload = req.body;
      payload.updatedAt = new Date().toISOString();
      memoryKvData = payload;

      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        const { kv } = await import('@vercel/kv');
        await kv.set('hesap_defteri_data', payload);
      }

      return res.json({
        success: true,
        message: "Veriler Vercel KV veritabanına kaydedildi.",
        updatedAt: payload.updatedAt
      });
    } catch (e: any) {
      return res.json({
        success: true,
        message: "Veriler yerel sunucu belleğine kaydedildi.",
        updatedAt: new Date().toISOString()
      });
    }
  });

  // Google Drive'dan dosya çekme uç noktası
  app.get("/api/fetch-gdrive", async (req, res) => {
    try {
      const driveUrl = (req.query.url as string || "").trim();
      if (!driveUrl) {
        return res.status(400).json({ error: "Google Drive dosya linki veya ID girilmedi." });
      }

      let fileId = driveUrl;
      const matchD = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const matchId = driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (matchD && matchD[1]) {
        fileId = matchD[1];
      } else if (matchId && matchId[1]) {
        fileId = matchId[1];
      }

      const directUrls = [
        `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
        `https://drive.google.com/uc?export=download&id=${fileId}`,
        `https://docs.google.com/uc?export=download&id=${fileId}`,
        `https://docs.google.com/document/d/${fileId}/export?format=txt`,
        `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`,
        `https://drive.google.com/file/d/${fileId}/view`
      ];

      let rawText = "";
      let fetchSuccess = false;

      for (const downloadUrl of directUrls) {
        try {
          const driveResp = await fetch(downloadUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            redirect: "follow"
          });

          if (driveResp.ok) {
            let text = await driveResp.text();

            if (text.includes("drive-confirm") || text.includes("confirm=") || text.includes("Google Drive - Virus scan warning")) {
              const confirmMatch = text.match(/confirm=([a-zA-Z0-9_-]+)/);
              if (confirmMatch && confirmMatch[1]) {
                const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch[1]}`;
                const confirmResp = await fetch(confirmUrl);
                if (confirmResp.ok) {
                  text = await confirmResp.text();
                }
              }
            }

            if (text && !text.includes("<!DOCTYPE html>") && !text.includes("<html")) {
              rawText = text;
              fetchSuccess = true;
              break;
            } else if (text && (text.includes("<!DOCTYPE html>") || text.includes("<html"))) {
              const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
              if (preMatch && preMatch[1]) {
                const extracted = preMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                if (extracted.trim()) {
                  rawText = extracted.trim();
                  fetchSuccess = true;
                  break;
                }
              }
            }
          }
        } catch (e: any) {}
      }

      if (!fetchSuccess || !rawText) {
        return res.status(400).json({
          error: "Google Drive dosyası okunamadı. Lütfen dosya paylaşım ayarlarının 'Bağlantıya sahip herkes görüntüleyebilir' olduğundan emin olun."
        });
      }

      return res.json({ success: true, fileId, content: rawText });
    } catch (err: any) {
      console.error("GDrive fetch error:", err);
      return res.status(500).json({ error: err.message || "Google Drive dosyası çekilirken hata oluştu." });
    }
  });

  // API Key Test Uç Noktası
  app.post("/api/test-key", async (req, res) => {
    try {
      const { provider = "groq", apiKey } = req.body;
      const DEFAULT_GROQ_KEY = "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";
      let keyToTest = apiKey ? String(apiKey).trim() : "";

      if (!keyToTest) {
        if (provider === "groq") {
          keyToTest = process.env.GROQ_API_KEY || DEFAULT_GROQ_KEY;
        } else if (provider === "gemini") {
          keyToTest = process.env.GEMINI_API_KEY || "";
        }
      }

      if (!keyToTest) {
        return res.status(400).json({ error: `Lütfen bir ${provider.toUpperCase()} API Key girin.` });
      }

      if (provider === "groq") {
        const resp = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${keyToTest}` }
        });
        if (resp.ok) {
          return res.json({
            valid: true,
            providerName: "Groq Cloud (Llama 3.3)",
            isServerKey: !apiKey,
            detailMsg: "Erişilebilir Modeller: <code>llama-3.3-70b-versatile, llama3-8b-8192</code>"
          });
        } else {
          const errJson = await resp.json().catch(() => ({}));
          return res.status(400).json({ error: errJson.error?.message || `HTTP ${resp.status}` });
        }
      } else if (provider === "gemini") {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToTest}`);
        if (resp.ok) {
          const data = await resp.json();
          const availableModels = (data.models || [])
            .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
            .map((m: any) => m.name.replace("models/", ""));
          return res.json({
            valid: true,
            providerName: "Google AI Studio (Gemini)",
            isServerKey: !apiKey,
            detailMsg: `Erişilebilir Modeller: <code>${availableModels.slice(0, 4).join(", ")}</code>`
          });
        } else {
          const errJson = await resp.json().catch(() => ({}));
          return res.status(400).json({ error: errJson.error?.message || `HTTP ${resp.status}` });
        }
      } else if (provider === "openai") {
        const resp = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${keyToTest}` }
        });
        if (resp.ok) {
          return res.json({
            valid: true,
            providerName: "OpenAI (ChatGPT)",
            isServerKey: !apiKey,
            detailMsg: "Erişilebilir Modeller: <code>gpt-4o-mini, gpt-4o</code>"
          });
        } else {
          const errJson = await resp.json().catch(() => ({}));
          return res.status(400).json({ error: errJson.error?.message || `HTTP ${resp.status}` });
        }
      } else if (provider === "openrouter") {
        const resp = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { "Authorization": `Bearer ${keyToTest}` }
        });
        if (resp.ok) {
          return res.json({
            valid: true,
            providerName: "OpenRouter",
            isServerKey: !apiKey,
            detailMsg: "OpenRouter Bağlantısı Başarılı!"
          });
        } else {
          const errJson = await resp.json().catch(() => ({}));
          return res.status(400).json({ error: errJson.error?.message || `HTTP ${resp.status}` });
        }
      }

      return res.status(400).json({ error: "Geçersiz servis sağlayıcı." });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || "Test sırasında hata oluştu." });
    }
  });

  // PDF Analiz Uç Noktası
  app.post("/api/analyze-pdf", async (req, res) => {
    try {
      const { provider = "gemini", base64, pdfText, apiKey } = req.body;
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

      if (!base64 && !pdfText) {
        return res.status(400).json({ error: "PDF verisi (base64 veya metin) eksik." });
      }

      const promptText = `Sen uzman bir finansal asistansın. Yüklenen banka veya kredi kartı ekstresindeki tüm harcama ve gider kalemlerini analiz et.
Görevin: Bu ekstredeki tüm harcama/işlem kalemlerini tam olarak çıkarıp kategorize etmek.
Sadece harcama/gider kalemlerini dahil et. Ödeme, borç kapatma veya iade kalemlerini ekleme.

Kategori için AŞAĞIDAKİ LİSTEDEN en uygun olan bir tanesini seç:
- Market
- Restoran & Kafe
- Yakıt
- Ulaşım
- Sağlık & Eczane
- Giyim
- Elektronik
- Eğlence
- Abonelikler
- Eğitim
- Seyahat
- Diğer Gider

Ekstre dönemini de YYYY-MM formatında (örneğin 2024-07) tespit et.

Yanıtını SADECE geçerli bir JSON formatında ver.
JSON şeması:
{
  "items": [
    { "description": "İşlem Açıklaması", "amount": 150.50, "category": "Market" }
  ],
  "cardName": "Banka Adı",
  "statementMonth": "YYYY-MM"
}`;

      if (provider === "groq") {
        const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${effectiveKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: "Sen finansal ekstre analiz uzmanısın. Sadece istenen JSON formatında yanıt ver." },
              { role: "user", content: promptText + "\n\nEKSTRE METNİ:\n" + (pdfText || "") }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
          })
        });

        if (!groqResp.ok) {
          const errData = await groqResp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Groq API Hatası (HTTP ${groqResp.status})`);
        }

        const groqData = await groqResp.json();
        const contentStr = groqData.choices?.[0]?.message?.content;
        if (!contentStr) throw new Error("Groq API boş yanıt döndürdü.");
        
        const parsed = JSON.parse(contentStr);
        return res.json(parsed);
      }

      if (provider === "openai") {
        const openAiResp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${effectiveKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Sen finansal ekstre analiz uzmanısın. Sadece istenen JSON formatında yanıt ver." },
              { role: "user", content: promptText + "\n\nEKSTRE METNİ:\n" + (pdfText || "") }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
          })
        });

        if (!openAiResp.ok) {
          const errData = await openAiResp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `OpenAI API Hatası (HTTP ${openAiResp.status})`);
        }

        const openAiData = await openAiResp.json();
        const contentStr = openAiData.choices?.[0]?.message?.content;
        if (!contentStr) throw new Error("OpenAI API boş yanıt döndürdü.");
        
        const parsed = JSON.parse(contentStr);
        return res.json(parsed);
      }

      if (provider === "openrouter") {
        const openRouterResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${effectiveKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ais-dev.run.app",
            "X-Title": "Hesap Defteri"
          },
          body: JSON.stringify({
            model: "google/gemini-2.0-flash-exp:free",
            messages: [
              { role: "system", content: "Sen finansal ekstre analiz uzmanısın. Sadece istenen JSON formatında yanıt ver." },
              { role: "user", content: promptText + "\n\nEKSTRE METNİ:\n" + (pdfText || "") }
            ],
            response_format: { type: "json_object" }
          })
        });

        if (!openRouterResp.ok) {
          const errData = await openRouterResp.json().catch(() => ({}));
          throw new Error(errData.error?.message || `OpenRouter API Hatası (HTTP ${openRouterResp.status})`);
        }

        const openRouterData = await openRouterResp.json();
        const contentStr = openRouterData.choices?.[0]?.message?.content;
        if (!contentStr) throw new Error("OpenRouter API boş yanıt döndürdü.");
        
        const parsed = JSON.parse(contentStr);
        return res.json(parsed);
      }

      // Google Gemini Provider
      const ai = new GoogleGenAI({ apiKey: effectiveKey });
      const parts: any[] = [];
      if (pdfText && pdfText.trim().length > 20) {
        parts.push({ text: "Aşağıda ekstrenin metin içeriği yer almaktadır:\n\n" + pdfText });
      } else if (base64) {
        parts.push({
          inlineData: {
            mimeType: "application/pdf",
            data: base64,
          },
        });
      }
      parts.push({ text: promptText });

      const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      let lastError: any = null;
      let responseText: string | null = null;

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ parts }],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  items: {
                    type: "ARRAY",
                    description: "Ekstredeki harcama ve gider kalemleri listesi",
                    items: {
                      type: "OBJECT",
                      properties: {
                        description: { type: "STRING" },
                        amount: { type: "NUMBER" },
                        category: { type: "STRING" },
                      },
                      required: ["description", "amount", "category"],
                    },
                  },
                  currency: { type: "STRING" },
                  cardName: { type: "STRING" },
                  statementMonth: { type: "STRING" },
                },
                required: ["items"],
              },
            },
          });
          if (response.text) {
            responseText = response.text;
            break;
          }
        } catch (err: any) {
          lastError = err;
          if (err.status === 401 || err.status === 403 || (err.message && err.message.includes("API key"))) {
            throw err;
          }
        }
      }

      if (!responseText) {
        throw lastError || new Error("Gemini API yanıt üretemedi.");
      }

      const parsed = JSON.parse(responseText);
      return res.json(parsed);
    } catch (err: any) {
      console.error("PDF analysis error:", err);
      return res.status(500).json({ error: err.message || "PDF analizi sırasında sunucu hatası oluştu." });
    }
  });

  // Vite Middleware (Geliştirme Ortamı) / Statik Sunum (Canlı Ortam)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
