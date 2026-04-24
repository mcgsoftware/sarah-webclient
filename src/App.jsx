import { useState, useRef, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import { TTSSession } from './tts-cartesia.js'
import { stripMarkdown } from './stripMarkdown.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000201'
const USER_ID = '00000000-0000-0000-0000-000000000002'

function MicIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? "#e74c3c" : "#888"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="12" fill="#333" />
      <path d="M12 16V8M12 8l-3.5 3.5M12 8l3.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VoiceIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="12" fill={active ? "#34c759" : "#ccc"} />
      <path d="M8 12c0 0 1.5-3 4-3s4 3 4 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 12c0 0 2.5-5 6-5s6 5 6 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="14" r="1.5" fill="#fff" />
    </svg>
  )
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [voiceMode, setVoiceMode] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const timerRef = useRef(null)
  const preRecordInputRef = useRef('')
  const ttsRef = useRef(null)
  const vadRef = useRef(null)
  const voiceModeRef = useRef(false)
  const voiceTranscriptRef = useRef('')
  const voiceProcessingRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Keep voiceModeRef in sync so async callbacks see current value
  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  const stopRecording = useCallback((cancel) => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (cancel) {
      setInput(preRecordInputRef.current)
    }
    setIsRecording(false)
    setRecordingTime(0)
    inputRef.current?.focus()
  }, [])

  const startRecording = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.')
      return
    }

    preRecordInputRef.current = input

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const prefix = preRecordInputRef.current
      setInput(prefix ? prefix + ' ' + transcript : transcript)
    }

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error)
      if (event.error !== 'aborted') {
        stopRecording(false)
      }
    }

    recognition.onend = () => {
      // Recognition ended naturally (e.g. silence timeout).
      // Don't restart — user controls via checkmark/X.
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
    setRecordingTime(0)

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1)
    }, 1000)
  }, [input, stopRecording])

  // handleSend that returns the response text (for voice mode TTS)
  const handleSend = useCallback(async (overrideText) => {
    if (isRecording) {
      stopRecording(false)
    }

    const text = (overrideText || input).trim()
    if (!text || loading) return null

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setLoading(true)

    let responseText = null
    try {
      const res = await fetch('/api/v1/chat/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': TENANT_ID,
          'X-User-Id': USER_ID,
        },
        body: JSON.stringify({ query: text }),
      })
      const data = await res.json()
      responseText = data.text || 'No response.'
      setMessages(prev => [...prev, { role: 'assistant', text: responseText }])
    } catch {
      responseText = 'Something went wrong. Please try again.'
      setMessages(prev => [...prev, { role: 'assistant', text: responseText }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }

    return responseText
  }, [input, loading, isRecording, stopRecording])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // --- Voice mode ---

  const startVoiceRecognition = useCallback(() => {
    if (!voiceModeRef.current) return

    // Abort any existing instance first
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch { /* ignore */ }
      recognitionRef.current = null
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      voiceTranscriptRef.current = transcript
    }

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Voice mode recognition error:', event.error)
      }
      // Don't restart here — let onend handle it to avoid double restarts
    }

    recognition.onend = () => {
      // Single restart point: only onend triggers restart
      if (voiceModeRef.current && !voiceProcessingRef.current) {
        setTimeout(() => {
          if (voiceModeRef.current && !voiceProcessingRef.current) {
            startVoiceRecognition()
          }
        }, 300)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [])

  const stopVoiceMode = useCallback(() => {
    setVoiceMode(false)
    voiceModeRef.current = false

    // Stop VAD
    if (vadRef.current) {
      vadRef.current.destroy()
      vadRef.current = null
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    // Stop TTS
    if (ttsRef.current) {
      ttsRef.current.stopPlayback()
      ttsRef.current = null
    }

    setIsSpeaking(false)
    voiceTranscriptRef.current = ''
  }, [])

  const startVoiceMode = useCallback(async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.')
      return
    }

    try {
      // Import VAD dynamically
      const { MicVAD } = await import('@ricky0123/vad-web')

      // Initialize TTS session
      ttsRef.current = new TTSSession()

      // Initialize VAD
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/vad/',
        onSpeechStart: () => {
          // Interrupt TTS if it's playing
          if (ttsRef.current) {
            ttsRef.current.stopPlayback()
            setIsSpeaking(false)
          }
        },
        onSpeechEnd: async () => {
          if (!voiceModeRef.current) return
          if (voiceProcessingRef.current) return

          const transcript = voiceTranscriptRef.current.trim()
          if (!transcript) return

          // Lock processing to prevent concurrent submissions
          voiceProcessingRef.current = true
          voiceTranscriptRef.current = ''

          // Stop recognition while we process
          if (recognitionRef.current) {
            try { recognitionRef.current.abort() } catch { /* ignore */ }
            recognitionRef.current = null
          }

          try {
            // Submit the transcript directly (avoid stale handleSend closure)
            setInput('')
            setMessages(prev => [...prev, { role: 'user', text: transcript }])
            setLoading(true)

            let responseText = null
            try {
              const res = await fetch('/api/v1/chat/ask', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Tenant-Id': TENANT_ID,
                  'X-User-Id': USER_ID,
                },
                body: JSON.stringify({ query: transcript }),
              })
              const data = await res.json()
              responseText = data.text || 'No response.'
              setMessages(prev => [...prev, { role: 'assistant', text: responseText }])
            } catch {
              setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }])
            } finally {
              setLoading(false)
            }

            // Speak the response via TTS
            if (responseText && voiceModeRef.current) {
              const cleanText = stripMarkdown(responseText)
              if (cleanText) {
                setIsSpeaking(true)
                try {
                  ttsRef.current = new TTSSession()
                  await ttsRef.current.speak(cleanText)
                } catch (err) {
                  console.error('TTS playback error:', err)
                }
                setIsSpeaking(false)
              }
            }
          } finally {
            // Unlock and resume listening
            voiceProcessingRef.current = false
            if (voiceModeRef.current) {
              startVoiceRecognition()
            }
          }
        },
      })

      vadRef.current = vad
      vad.start()

      setVoiceMode(true)
      voiceModeRef.current = true

      // Start Web Speech API for transcription
      startVoiceRecognition()
    } catch (err) {
      console.error('Failed to start voice mode:', err)
      alert('Failed to start voice mode. Check console for details.')
      stopVoiceMode()
    }
  }, [startVoiceRecognition, stopVoiceMode])

  const toggleVoiceMode = useCallback(() => {
    if (voiceMode) {
      stopVoiceMode()
    } else {
      startVoiceMode()
    }
  }, [voiceMode, startVoiceMode, stopVoiceMode])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) vadRef.current.destroy()
      if (ttsRef.current) ttsRef.current.disconnect()
      if (recognitionRef.current) recognitionRef.current.abort()
    }
  }, [])

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
  }

  const showSend = !isRecording && input.trim() !== ''

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>ElderNexus</h1>
        {voiceMode && (
          <div className="voice-status">
            {isSpeaking ? (
              <span className="voice-status-text speaking">
                <span className="speaker-wave" />
                Speaking...
              </span>
            ) : (
              <span className="voice-status-text listening">
                <span className="listening-dot" />
                Listening...
              </span>
            )}
          </div>
        )}
      </header>

      <main className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">What can Annie help with?</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="bubble">
              {msg.role === 'assistant' ? <Markdown>{msg.text}</Markdown> : msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="bubble typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="chat-input-bar">
        {isRecording && (
          <div className="recorder-widget">
            <span className="recorder-time">{formatTime(recordingTime)}</span>
            <div className="recorder-waveform">
              <span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            <button className="recorder-btn recorder-cancel" onClick={() => stopRecording(true)} aria-label="Cancel recording">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <button className="recorder-btn recorder-accept" onClick={() => stopRecording(false)} aria-label="Accept recording">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask anything"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          {showSend ? (
            <button
              className="icon-btn"
              onClick={() => handleSend()}
              disabled={loading}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          ) : (
            <>
              <button
                className={`icon-btn${isRecording ? ' mic-active' : ''}`}
                onClick={isRecording ? () => stopRecording(false) : startRecording}
                disabled={loading || voiceMode}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                <MicIcon active={isRecording} />
              </button>
              <button
                className={`icon-btn${voiceMode ? ' voice-active' : ''}`}
                onClick={toggleVoiceMode}
                disabled={loading || isRecording}
                aria-label={voiceMode ? 'Stop voice mode' : 'Start voice mode'}
                title={voiceMode ? 'Voice mode active' : 'Start voice mode'}
              >
                <VoiceIcon active={voiceMode} />
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
