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
    // Body string olarak geldiyse güvenli şekilde parse et
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (err) {
        body = {};
      }
    }
    const { provider = "groq", apiKey } = body || {};

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
        return res.status(200).json({
          valid: true,
          providerName: "Groq Cloud (Llama 3.3)",
          isServerKey: !apiKey,
          detailMsg: "Erişilebilir Modeller: <code>llama-3.3-70b-versatile, llama3-8b-8192</code>"
        });
      } else {
        const errJson = await resp.json().catch(() => ({}));
        return res.status(400).json({ 
          error: errJson.error?.message || `Groq API doğrulanamadı (HTTP ${resp.status})` 
        });
      }
    } else if (provider === "gemini") {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyToTest}`);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const availableModels = (data.models || [])
          .filter((m) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
          .map((m) => m.name.replace("models/", ""));
        return res.status(200).json({
          valid: true,
          providerName: "Google AI Studio (Gemini)",
          isServerKey: !apiKey,
          detailMsg: `Erişilebilir Modeller: <code>${availableModels.slice(0, 4).join(", ") || 'gemini-2.5-flash'}</code>`
        });
      } else {
        const errJson = await resp.json().catch(() => ({}));
        return res.status(400).json({ 
          error: errJson.error?.message || `Gemini API doğrulanamadı (HTTP ${resp.status})` 
        });
      }
    } else if (provider === "openai") {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${keyToTest}` }
      });
      if (resp.ok) {
        return res.status(200).json({
          valid: true,
          providerName: "OpenAI (ChatGPT)",
          isServerKey: !apiKey,
          detailMsg: "Erişilebilir Modeller: <code>gpt-4o-mini, gpt-4o</code>"
        });
      } else {
        const errJson = await resp.json().catch(() => ({}));
        return res.status(400).json({ 
          error: errJson.error?.message || `OpenAI API doğrulanamadı (HTTP ${resp.status})` 
        });
      }
    } else if (provider === "openrouter") {
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${keyToTest}` }
      });
      if (resp.ok) {
        return res.status(200).json({
          valid: true,
          providerName: "OpenRouter",
          isServerKey: !apiKey,
          detailMsg: "OpenRouter Bağlantısı Başarılı!"
        });
      } else {
        const errJson = await resp.json().catch(() => ({}));
        return res.status(400).json({ 
          error: errJson.error?.message || `OpenRouter API doğrulanamadı (HTTP ${resp.status})` 
        });
      }
    }

    return res.status(400).json({ error: "Geçersiz servis sağlayıcı." });
  } catch (e) {
    console.error("Test Key Error:", e);
    return res.status(400).json({ error: "Bağlantı veya doğrulama hatası: " + (e.message || "Bilinmeyen hata") });
  }
}
