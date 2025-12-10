/**
 * Voice Enrollment Modal for ARGUS Mobile
 * Identical to the extension's voice-record tab, but inline
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

const ASSEMBLY_AI_API_KEY = '739eaea781644ce09713aa29f34c61a9';
const API_BASE = 'https://api.assemblyai.com/v2';

interface VoiceEnrollmentModalProps {
  show: boolean;
  mode: 'enroll' | 'verify' | 'verify-to-disable';
  walletAddress: string;
  enrolledFingerprint?: string;
  onComplete: (result: { success: boolean; fingerprint?: string; error?: string }) => void;
  onClose: () => void;
}

// Sleep utility
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Transcribe audio with Assembly AI
async function transcribeAudio(audioBlob: Blob): Promise<string> {
  // Upload
  const uploadRes = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLY_AI_API_KEY },
    body: audioBlob
  });
  if (!uploadRes.ok) throw new Error('Upload failed');
  const { upload_url } = await uploadRes.json();
  
  // Request transcription
  const transcriptRes = await fetch(`${API_BASE}/transcript`, {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLY_AI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, speech_model: 'best' })
  });
  if (!transcriptRes.ok) throw new Error('Transcription failed');
  const { id } = await transcriptRes.json();
  
  // Poll for result
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const pollRes = await fetch(`${API_BASE}/transcript/${id}`, {
      headers: { 'Authorization': ASSEMBLY_AI_API_KEY }
    });
    const data = await pollRes.json();
    if (data.status === 'completed') return data.text || '';
    if (data.status === 'error') throw new Error('Transcription error');
  }
  throw new Error('Timeout');
}

// Check if two phrases match (at least 40% word overlap)
function phraseMatches(phrase1: string, phrase2: string): boolean {
  const words1 = phrase1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  const words2 = phrase2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return false;
  
  const matches = words1.filter(w => words2.includes(w)).length;
  const threshold = Math.min(words1.length, words2.length) * 0.4;
  return matches >= threshold;
}

export const VoiceEnrollmentModal: React.FC<VoiceEnrollmentModalProps> = ({
  show,
  mode,
  walletAddress,
  enrolledFingerprint,
  onComplete,
  onClose
}) => {
  const [currentSample, setCurrentSample] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Tap to record your voice');
  const [statusType, setStatusType] = useState<'' | 'error' | 'success'>('');
  const [waveBars, setWaveBars] = useState<number[]>(Array(24).fill(6));
  
  const storedPassphraseRef = useRef('');
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  const totalSamples = (mode === 'verify' || mode === 'verify-to-disable') ? 1 : 3;
  
  // Parse enrolled passphrase for verification
  const enrolledPassphrase = React.useMemo(() => {
    if ((mode === 'verify' || mode === 'verify-to-disable') && enrolledFingerprint) {
      try {
        const decoded = decodeURIComponent(enrolledFingerprint);
        const data = JSON.parse(atob(decoded));
        return data.passphraseHash ? atob(data.passphraseHash) : '';
      } catch (e) {
        console.error('[VoiceModal] Failed to parse fingerprint:', e);
        return '';
      }
    }
    return '';
  }, [mode, enrolledFingerprint]);

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setCurrentSample(0);
      setIsRecording(false);
      const isVerifyMode = mode === 'verify' || mode === 'verify-to-disable';
      setStatus(isVerifyMode 
        ? (mode === 'verify-to-disable' ? 'Tap to verify voice to disable' : 'Tap to unlock with your voice') 
        : 'Tap to record your voice');
      setStatusType('');
      setWaveBars(Array(24).fill(6));
      storedPassphraseRef.current = '';
    }
  }, [show, mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Visualize audio
  const visualizeAudio = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const draw = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      
      const barCount = 24;
      const step = Math.floor(dataArray.length / barCount);
      
      const newBars = Array(barCount).fill(0).map((_, i) => {
        const value = dataArray[i * step];
        const percent = value / 255;
        return Math.max(6, percent * 50);
      });
      
      setWaveBars(newBars);
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    
    draw();
  }, []);

  // Reset wave bars
  const resetWaveBars = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    analyserRef.current = null;
    setWaveBars(Array(24).fill(6));
  }, []);

  // Record audio with visualization
  const recordAudio = useCallback(async (maxDuration: number = 3000): Promise<{ audio: Blob; duration: number }> => {
    return new Promise(async (resolve, reject) => {
      let audioContext: AudioContext | null = null;
      
      try {
        setStatus('Listening...');
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        
        // Set up audio analysis for visualization
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyserRef.current = analyser;
        
        setStatus('Recording... Speak now');
        visualizeAudio();
        
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: Blob[] = [];
        const startTime = Date.now();
        
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        
        mediaRecorder.onstop = () => {
          const duration = Date.now() - startTime;
          stream.getTracks().forEach(track => track.stop());
          if (audioContext) audioContext.close();
          resetWaveBars();
          resolve({ audio: new Blob(chunks, { type: 'audio/webm' }), duration });
        };
        
        mediaRecorder.onerror = () => {
          stream.getTracks().forEach(track => track.stop());
          if (audioContext) audioContext.close();
          resetWaveBars();
          reject(new Error('Recording error'));
        };
        
        mediaRecorder.start();
        setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, maxDuration);
        
      } catch (e) {
        if (audioContext) audioContext.close();
        resetWaveBars();
        reject(e);
      }
    });
  }, [visualizeAudio, resetWaveBars]);

  // Process enrollment
  const processEnrollment = useCallback(async () => {
    if (isRecording) return;
    setIsRecording(true);
    
    try {
      const { audio, duration } = await recordAudio(3000);
      
      if (duration < 1000) {
        setStatus('Too short. Speak clearly.');
        setStatusType('error');
        setIsRecording(false);
        return;
      }
      
      setStatus('Analyzing voice pattern...');
      const transcript = await transcribeAudio(audio);
      
      if (!transcript || transcript.trim().length < 2) {
        setStatus('No voice detected. Try again.');
        setStatusType('error');
        setIsRecording(false);
        return;
      }
      
      // First sample sets the passphrase
      if (currentSample === 0) {
        storedPassphraseRef.current = transcript.toLowerCase().trim();
      } else {
        // Check if matches stored passphrase
        if (!phraseMatches(storedPassphraseRef.current, transcript)) {
          setStatus('Voice pattern mismatch. Say the same phrase.');
          setStatusType('error');
          setIsRecording(false);
          return;
        }
      }
      
      const newSampleCount = currentSample + 1;
      setCurrentSample(newSampleCount);
      
      if (newSampleCount >= totalSamples) {
        // Complete enrollment
        setStatus('Creating voiceprint...');
        
        const fingerprintData = {
          version: 3,
          walletAddress,
          passphraseHash: btoa(storedPassphraseRef.current),
          samplesCount: totalSamples,
          enrolledAt: Date.now()
        };
        
        const fingerprint = btoa(JSON.stringify(fingerprintData));
        
        setStatus('Voice enrolled!');
        setStatusType('success');
        
        setTimeout(() => {
          onComplete({ success: true, fingerprint });
        }, 1000);
      } else {
        setStatus(`Voice captured. ${totalSamples - newSampleCount} more sample${totalSamples - newSampleCount > 1 ? 's' : ''}`);
        setStatusType('success');
        setIsRecording(false);
      }
      
    } catch (e: any) {
      setStatus(e.name === 'NotAllowedError' ? 'Microphone denied' : 'Error occurred');
      setStatusType('error');
      setIsRecording(false);
    }
  }, [isRecording, currentSample, totalSamples, walletAddress, recordAudio, onComplete]);

  // Process verification
  const processVerification = useCallback(async () => {
    if (isRecording) return;
    setIsRecording(true);
    
    try {
      const { audio, duration } = await recordAudio(3000);
      
      if (duration < 800) {
        setStatus('Too short. Speak clearly.');
        setStatusType('error');
        setIsRecording(false);
        return;
      }
      
      setStatus('Verifying...');
      const transcript = await transcribeAudio(audio);
      
      if (!transcript || transcript.trim().length < 2) {
        setStatus('No voice detected. Try again.');
        setStatusType('error');
        setIsRecording(false);
        return;
      }
      
      // Check if matches enrolled passphrase
      const isMatch = phraseMatches(enrolledPassphrase, transcript);
      
      if (isMatch) {
        setStatus('Voice verified!');
        setStatusType('success');
        
        setTimeout(() => {
          onComplete({ success: true });
        }, 1000);
      } else {
        setStatus('Wrong phrase, try again.');
        setStatusType('error');
        setIsRecording(false);
      }
      
    } catch (e: any) {
      setStatus(e.name === 'NotAllowedError' ? 'Microphone denied' : 'Error occurred');
      setStatusType('error');
      setIsRecording(false);
    }
  }, [isRecording, enrolledPassphrase, recordAudio, onComplete]);

  const handleRecordClick = useCallback(() => {
    if (mode === 'verify' || mode === 'verify-to-disable') {
      processVerification();
    } else {
      processEnrollment();
    }
  }, [mode, processVerification, processEnrollment]);

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Video Background */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          opacity: 0.6
        }}
      >
        <source src="https://brown-traditional-sheep-998.mypinata.cloud/ipfs/bafybeicmrwektqnpcgast66rua3czhzwx2aasfncb6zdzysmnsfosewfw4" type="video/mp4" />
      </video>
      
      {/* Dark overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.7) 100%)',
        zIndex: 1
      }} />
      
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3,
          fontSize: 18
        }}
      >
        ✕
      </button>
      
      {/* Main content */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        maxWidth: 320,
        width: '100%',
        textAlign: 'center',
        padding: '16px 20px'
      }}>
        {/* Logo */}
        <img 
          src="https://brown-traditional-sheep-998.mypinata.cloud/ipfs/bafybeig5u6fttg63dicccooqvz4ttwi2xkxi3z5sbjzosh7tgenatsyrii" 
          alt="ARGUS"
          style={{
            width: 60,
            height: 60,
            marginBottom: 8,
            filter: 'drop-shadow(0 0 20px rgba(255,255,255,0.3))'
          }}
        />
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 5,
          marginBottom: 2,
          color: '#fff',
          textShadow: '0 0 20px rgba(255,255,255,0.3)'
        }}>ARGUS</div>
        <div style={{
          fontSize: 9,
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 20,
          textTransform: 'uppercase',
          letterSpacing: 3
        }}>
          {mode === 'verify' ? 'Voice Unlock' : 'Voice Biometrics'}
        </div>
        
        {/* Progress dots (only for enrollment) */}
        {mode === 'enroll' && (
          <div style={{
            display: 'flex',
            gap: 10,
            marginBottom: 18,
            justifyContent: 'center'
          }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: i < currentSample 
                    ? '#22c55e' 
                    : i === currentSample 
                      ? 'rgba(34, 197, 94, 0.5)' 
                      : 'rgba(255,255,255,0.15)',
                  transition: 'all 0.3s ease',
                  boxShadow: i < currentSample 
                    ? '0 0 15px rgba(34, 197, 94, 0.6)' 
                    : i === currentSample 
                      ? '0 0 10px rgba(34, 197, 94, 0.4)' 
                      : '0 0 10px rgba(0,0,0,0.5)'
                }}
              />
            ))}
          </div>
        )}
        
        {/* Instruction */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 1
          }}>
            {mode === 'verify' ? 'Say your passphrase' : "Say any phrase you'll remember"}
          </div>
          <div style={{
            fontSize: 16,
            color: '#fff',
            fontWeight: 300,
            letterSpacing: 1,
            textShadow: '0 2px 10px rgba(0,0,0,0.5)'
          }}>
            {mode === 'verify' ? 'Speak to unlock' : 'Your voice is your password'}
          </div>
        </div>
        
        {/* Waveform */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          height: 50,
          marginBottom: 18
        }}>
          {waveBars.map((height, i) => (
            <div
              key={i}
              style={{
                width: 4,
                borderRadius: 4,
                height: height,
                background: height > 10 
                  ? 'linear-gradient(to top, #22c55e, #4ade80)' 
                  : 'rgba(255,255,255,0.15)',
                transition: 'height 0.06s ease-out, background 0.1s'
              }}
            />
          ))}
        </div>
        
        {/* Record button */}
        <button
          onClick={handleRecordClick}
          disabled={isRecording && status.includes('Analyzing')}
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: isRecording ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.08)',
            border: isRecording ? '2px solid rgba(34, 197, 94, 0.5)' : '2px solid rgba(255,255,255,0.2)',
            cursor: isRecording ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            transition: 'all 0.2s',
            backdropFilter: 'blur(10px)',
            animation: isRecording ? 'voicePulse 1.5s infinite' : 'none'
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        
        {/* Status */}
        <div style={{
          fontSize: 13,
          color: statusType === 'error' 
            ? '#ef4444' 
            : statusType === 'success' 
              ? '#22c55e' 
              : 'rgba(255,255,255,0.6)',
          minHeight: 18,
          textAlign: 'center',
          textShadow: '0 2px 8px rgba(0,0,0,0.5)'
        }}>
          {status}
        </div>
        
        {/* Footer */}
        <div style={{
          fontSize: 9,
          color: 'rgba(255,255,255,0.3)',
          textAlign: 'center',
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,0.1)'
        }}>
          🔐 Your unique voice pattern will be captured
        </div>
      </div>
      
      {/* Keyframe animation for pulse */}
      <style>{`
        @keyframes voicePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50% { box-shadow: 0 0 0 20px rgba(34, 197, 94, 0); }
        }
      `}</style>
    </div>
  );
};

export default VoiceEnrollmentModal;
