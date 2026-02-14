# Sheep Telegram'da Cevap Vermiyor — Rate Limit Çözümü

## Sorun

Telegram'da "Hello" yazdığınızda cevap gelmiyor ve şu hata görünüyor:

```
⚠️ Agent failed before reply: All models failed (3): anthropic/claude-opus-4-6: 
Provider anthropic is in cooldown (all profiles unavailable) (rate_limit) | 
anthropic/claude-opus-4-5: Provider anthropic is in cooldown... | 
anthropic/claude-sonnet-4-5: Provider anthropic is in cooldown...
```

**Sebep:** Tüm modeller Anthropic (Claude). Anthropic rate limit'e girdiğinde tüm profiller cooldown'a geçiyor ve hiçbir fallback çalışmıyor.

---

## Hızlı Çözüm

OpenClaw config'inize **farklı sağlayıcıdan** (OpenAI veya Google) fallback model ekleyin.

### 1. OpenClaw config dosyasını bulun

Config genellikle şu yerlerdedir:
- `~/.openclaw/config.yaml` veya `config.json`
- Proje kökünde `openclaw.json` veya `config.yaml`

### 2. Model fallback ekleyin

**agents.defaults.model** altına `fallbacks` ekleyin — ve **mutlaka farklı provider** kullanın:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openai/gpt-4o",
          "google/gemini-2.5-flash-preview-05-20"
        ]
      }
    }
  }
}
```

**YAML kullanıyorsanız:**

```yaml
agents:
  defaults:
    model:
      primary: anthropic/claude-sonnet-4-5
      fallbacks:
        - openai/gpt-4o
        - google/gemini-2.5-flash-preview-05-20
```

### 3. Gerekli API anahtarları

Fallback'lerin çalışması için:

- **OpenAI** fallback için: `OPENAI_API_KEY` veya OpenClaw auth'ta OpenAI profili
- **Google** fallback için: `GOOGLE_AI_API_KEY` veya OpenClaw auth'ta Google profili

### 4. Agent'ı yeniden başlatın

```bash
# OpenClaw'ı yeniden başlat
# Örneğin process manager kullanıyorsanız:
pm2 restart openclaw
# veya
openclaw start
```

---

## Şu anki durumu kontrol et

```bash
openclaw models status --probe
```

Bu komut hangi modellerin hazır olduğunu gösterir.

---

## Context overflow önleme (isteğe bağlı)

Uzun konuşmalar rate limit'i tetikleyebilir. Compaction'ı açın:

```bash
openclaw config set agents.defaults.compaction.mode safeguard
```

---

## Birden fazla Anthropic API key (isteğe bağlı)

Rate limit'i dağıtmak için birden fazla Anthropic key ekleyebilirsiniz:

```json
{
  "models": {
    "anthropic": {
      "auth": [
        { "apiKey": "sk-ant-api03-key1..." },
        { "apiKey": "sk-ant-api03-key2..." }
      ]
    }
  }
}
```

Bu yine de Anthropic cooldown'da iken çalışmaz; en güvenilir çözüm **farklı sağlayıcı fallback** eklemektir.

---

## Özet

| Adım | Eylem |
|------|-------|
| 1 | `fallbacks` içine `openai/gpt-4o` veya `google/gemini-2.5-flash` ekleyin |
| 2 | OpenAI/Google API key'inizi OpenClaw'a tanımlayın |
| 3 | Agent'ı yeniden başlatın |
| 4 | `openclaw models status --probe` ile durumu kontrol edin |

---

Kaynak: [OpenClaw Rate Limit Help](https://www.getopenclaw.ai/help/rate-limit-cooldown-all-models-failed)
