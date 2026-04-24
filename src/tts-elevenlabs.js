const VOICE_ID = '21m00Tcm4TlvDq8ikWAM' // Rachel
const WS_URL = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input`
const SAMPLE_RATE = 24000

export class TTSSession {
  constructor() {
    this.ws = null
    this.audioCtx = null
    this.scheduledEnd = 0
    this.playing = false
    this._resolveFinished = null
    this._pendingSources = []
    this._pendingChunks = 0
    this._streamEnded = false
  }

  async ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return

    const res = await fetch('/api/tts-token', { method: 'POST' })
    if (!res.ok) throw new Error(`TTS token request failed: ${res.status}`)
    const { token } = await res.json()

    return new Promise((resolve, reject) => {
      const url = `${WS_URL}?model_id=eleven_turbo_v2_5&output_format=pcm_${SAMPLE_RATE}&single_use_token=${token}`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }))
        resolve()
      }

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.error) {
          console.error('TTS ElevenLabs error:', msg)
        }
        if (msg.audio) {
          this._pendingChunks++
          this._enqueuePCM(msg.audio)
          this._pendingChunks--
          this._maybeFinish()
        }
        if (msg.isFinal) {
          this._streamEnded = true
          this._maybeFinish()
        }
      }

      this.ws.onerror = (err) => {
        console.error('TTS WebSocket error:', err)
        reject(err)
      }

      this.ws.onclose = () => {
        this.ws = null
      }
    })
  }

  async speak(text) {
    if (!text.trim()) return

    this.scheduledEnd = 0
    this.playing = true
    this._pendingSources = []
    this._pendingChunks = 0
    this._streamEnded = false

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext()
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }

    await this.ensureConnected()

    return new Promise((resolve) => {
      this._resolveFinished = resolve

      this.ws.send(JSON.stringify({
        text: text,
        flush: true,
      }))

      this.ws.send(JSON.stringify({ text: '' }))
    })
  }

  stopPlayback() {
    for (const src of this._pendingSources) {
      try { src.stop() } catch { /* already stopped */ }
    }
    this._pendingSources = []
    this.scheduledEnd = 0
    this.playing = false
    this._streamEnded = true

    if (this._resolveFinished) {
      this._resolveFinished()
      this._resolveFinished = null
    }

    this.disconnect()
  }

  disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close() } catch { /* ignore */ }
    }
    this.ws = null
  }

  _enqueuePCM(base64Audio) {
    if (!this.playing || !this.audioCtx) return

    try {
      // Decode base64 to raw bytes (16-bit signed PCM)
      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }

      // Convert 16-bit signed PCM to Float32 samples
      const int16 = new Int16Array(bytes.buffer)
      const numSamples = int16.length
      if (numSamples === 0) return

      const audioBuffer = this.audioCtx.createBuffer(1, numSamples, SAMPLE_RATE)
      const channelData = audioBuffer.getChannelData(0)
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = int16[i] / 32768
      }

      const source = this.audioCtx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioCtx.destination)
      this._pendingSources.push(source)

      const startTime = Math.max(this.audioCtx.currentTime, this.scheduledEnd)
      source.start(startTime)
      this.scheduledEnd = startTime + audioBuffer.duration

      source.onended = () => {
        const idx = this._pendingSources.indexOf(source)
        if (idx !== -1) this._pendingSources.splice(idx, 1)
      }
    } catch (err) {
      console.error('Failed to process audio chunk:', err)
    }
  }

  _maybeFinish() {
    if (!this._streamEnded || this._pendingChunks > 0) return
    if (!this.playing) return

    const remaining = this.scheduledEnd - this.audioCtx.currentTime
    const delay = remaining > 0 ? remaining * 1000 + 100 : 0

    setTimeout(() => {
      this.playing = false
      this.disconnect()
      if (this._resolveFinished) {
        this._resolveFinished()
        this._resolveFinished = null
      }
    }, delay)
  }
}
