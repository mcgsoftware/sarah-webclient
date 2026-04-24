const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes'
const VOICE_ID = 'e07c00bc-4134-4eae-9ea4-1a55fb45746b'
const SAMPLE_RATE = 44100

export class TTSSession {
  constructor() {
    this.audioCtx = null
    this.currentSource = null
    this.playing = false
  }

  async speak(text) {
    if (!text.trim()) return

    this.playing = true

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    // 1. Get short-lived JWT from our backend
    const tokenRes = await fetch('/api/cartesia-token', { method: 'POST' })
    if (!tokenRes.ok) throw new Error(`Cartesia token request failed: ${tokenRes.status}`)
    const { token } = await tokenRes.json()

    // 2. Call Cartesia TTS directly from browser
    const ttsRes = await fetch(CARTESIA_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cartesia-Version': '2025-04-16',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'sonic-3',
        transcript: text,
        voice: { mode: 'id', id: VOICE_ID },
        output_format: {
          container: 'wav',
          encoding: 'pcm_f32le',
          sample_rate: SAMPLE_RATE,
        },
        language: 'en',
        generation_config: {
          speed: 0.9,
          volume: 1.2,
          emotion: 'calm',
        },
      }),
    })

    if (!ttsRes.ok) {
      const errText = await ttsRes.text()
      throw new Error(`Cartesia TTS failed (${ttsRes.status}): ${errText}`)
    }

    if (!this.playing) return // stopped while fetching

    // 3. Decode and play the WAV
    const arrayBuffer = await ttsRes.arrayBuffer()
    if (!this.playing) return

    const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer)
    if (!this.playing) return

    return new Promise((resolve) => {
      const source = this.audioCtx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioCtx.destination)
      this.currentSource = source

      source.onended = () => {
        this.currentSource = null
        this.playing = false
        resolve()
      }

      source.start()
    })
  }

  stopPlayback() {
    this.playing = false
    if (this.currentSource) {
      try { this.currentSource.stop() } catch { /* already stopped */ }
      this.currentSource = null
    }
  }

  disconnect() {
    // No persistent connection to tear down (REST-based)
  }
}
