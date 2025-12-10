/**
 * Voice Authentication Module for ARGUS Mobile Web App
 * Web-compatible version using MediaRecorder API
 */

export const VOICE_SETUP_CONFIG = {
  requiredSamples: 3,
  minDuration: 1500,
  maxDuration: 3000,
}

interface VoiceVerifyResult {
  success: boolean
  confidence: number
  error?: string
}

// Storage key for voice fingerprints
const VOICE_STORAGE_KEY = 'geovault_voice_fingerprints';

/**
 * Check microphone permission
 */
export async function checkMicrophonePermission(): Promise<boolean> {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * Request microphone permission
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract voice features from audio data (simplified fingerprint)
 */
function extractVoiceFeatures(audioData: Float32Array, sampleRate: number): number[] {
  const features: number[] = [];
  
  // Basic features: energy, zero crossing rate, spectral centroid approximation
  const frameSize = 2048;
  const numFrames = Math.floor(audioData.length / frameSize);
  
  for (let i = 0; i < Math.min(numFrames, 20); i++) {
    const frame = audioData.slice(i * frameSize, (i + 1) * frameSize);
    
    // Energy
    let energy = 0;
    for (let j = 0; j < frame.length; j++) {
      energy += frame[j] * frame[j];
    }
    features.push(energy / frame.length);
    
    // Zero crossing rate
    let zcr = 0;
    for (let j = 1; j < frame.length; j++) {
      if ((frame[j] >= 0) !== (frame[j - 1] >= 0)) zcr++;
    }
    features.push(zcr / frame.length);
  }
  
  return features;
}

/**
 * Calculate similarity between two voice fingerprints
 */
function calculateSimilarity(fp1: number[], fp2: number[]): number {
  if (fp1.length !== fp2.length || fp1.length === 0) return 0;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < fp1.length; i++) {
    dotProduct += fp1[i] * fp2[i];
    norm1 += fp1[i] * fp1[i];
    norm2 += fp2[i] * fp2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Record audio sample using MediaRecorder
 */
async function recordAudioSample(durationMs: number = 2000): Promise<Float32Array> {
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  source.connect(analyser);
  
  const bufferLength = analyser.fftSize;
  const samples: Float32Array[] = [];
  
  return new Promise((resolve) => {
    const collectSamples = () => {
      const dataArray = new Float32Array(bufferLength);
      analyser.getFloatTimeDomainData(dataArray);
      samples.push(new Float32Array(dataArray));
    };
    
    const interval = setInterval(collectSamples, 50);
    
    setTimeout(() => {
      clearInterval(interval);
      stream.getTracks().forEach(track => track.stop());
      audioContext.close();
      
      // Combine samples
      const totalLength = samples.reduce((acc, s) => acc + s.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const sample of samples) {
        combined.set(sample, offset);
        offset += sample.length;
      }
      
      resolve(combined);
    }, durationMs);
  });
}

/**
 * Start voice enrollment - web version using modal
 */
export async function startVoiceEnrollment(walletAddress: string): Promise<{
  success: boolean
  fingerprint?: string
  error?: string
}> {
  try {
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      return { success: false, error: 'Microphone permission denied' };
    }
    
    const samples: number[][] = [];
    
    // Collect 3 voice samples
    for (let i = 0; i < VOICE_SETUP_CONFIG.requiredSamples; i++) {
      console.log(`[Voice] Recording sample ${i + 1}/${VOICE_SETUP_CONFIG.requiredSamples}`);
      
      // Wait a moment between samples
      if (i > 0) {
        await new Promise(r => setTimeout(r, 500));
      }
      
      const audioData = await recordAudioSample(VOICE_SETUP_CONFIG.maxDuration);
      const features = extractVoiceFeatures(audioData, 44100);
      samples.push(features);
    }
    
    // Average the features to create fingerprint
    const fingerprint: number[] = [];
    const featureLength = samples[0].length;
    
    for (let i = 0; i < featureLength; i++) {
      let sum = 0;
      for (const sample of samples) {
        sum += sample[i] || 0;
      }
      fingerprint.push(sum / samples.length);
    }
    
    // Store fingerprint
    const stored = getStoredFingerprints();
    stored[walletAddress] = fingerprint;
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(stored));
    
    return {
      success: true,
      fingerprint: JSON.stringify(fingerprint)
    };
    
  } catch (error: any) {
    console.error('[Voice] Enrollment error:', error);
    return { success: false, error: error.message || 'Voice enrollment failed' };
  }
}

/**
 * Enroll a single voice sample
 */
export async function enrollVoiceSample(): Promise<{
  success: boolean
  features?: number[]
  error?: string
}> {
  try {
    const audioData = await recordAudioSample(VOICE_SETUP_CONFIG.maxDuration);
    const features = extractVoiceFeatures(audioData, 44100);
    return { success: true, features };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Complete voice enrollment with collected samples
 */
export async function completeVoiceEnrollment(
  walletAddress: string,
  samples: number[][]
): Promise<{ success: boolean; fingerprint?: string; error?: string }> {
  try {
    if (samples.length < VOICE_SETUP_CONFIG.requiredSamples) {
      return { success: false, error: 'Not enough samples' };
    }
    
    // Average the features
    const fingerprint: number[] = [];
    const featureLength = samples[0].length;
    
    for (let i = 0; i < featureLength; i++) {
      let sum = 0;
      for (const sample of samples) {
        sum += sample[i] || 0;
      }
      fingerprint.push(sum / samples.length);
    }
    
    // Store
    const stored = getStoredFingerprints();
    stored[walletAddress] = fingerprint;
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(stored));
    
    return { success: true, fingerprint: JSON.stringify(fingerprint) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get stored fingerprints
 */
function getStoredFingerprints(): Record<string, number[]> {
  try {
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Verify voice against stored fingerprint
 */
export async function verifyVoice(enrolledFingerprint: string): Promise<VoiceVerifyResult> {
  try {
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      return { success: false, confidence: 0, error: 'Microphone permission denied' };
    }
    
    // Fingerprint is base64 encoded JSON - decode first
    let fingerprintData: any;
    try {
      const decoded = atob(enrolledFingerprint);
      fingerprintData = JSON.parse(decoded);
    } catch (e) {
      // Try direct JSON parse if not base64
      try {
        fingerprintData = JSON.parse(enrolledFingerprint);
      } catch (e2) {
        console.error('[Voice] Cannot parse fingerprint:', e2);
        return { success: false, confidence: 0, error: 'Invalid voice fingerprint format' };
      }
    }
    
    // Extract stored features - could be in different formats
    let storedFp: number[];
    if (Array.isArray(fingerprintData)) {
      storedFp = fingerprintData;
    } else if (fingerprintData.features && Array.isArray(fingerprintData.features)) {
      storedFp = fingerprintData.features;
    } else if (fingerprintData.averageFeatures && Array.isArray(fingerprintData.averageFeatures)) {
      storedFp = fingerprintData.averageFeatures;
    } else {
      console.error('[Voice] Unknown fingerprint format:', fingerprintData);
      return { success: false, confidence: 0, error: 'Unknown voice fingerprint format' };
    }
    
    // Record new sample
    const audioData = await recordAudioSample(VOICE_SETUP_CONFIG.maxDuration);
    const currentFeatures = extractVoiceFeatures(audioData, 44100);
    
    // Compare
    const similarity = calculateSimilarity(storedFp, currentFeatures);
    const threshold = 0.7;
    
    console.log(`[Voice] Similarity: ${similarity.toFixed(3)}, threshold: ${threshold}`);
    
    return {
      success: similarity >= threshold,
      confidence: similarity
    };
    
  } catch (error: any) {
    console.error('[Voice] Verification error:', error);
    return { success: false, confidence: 0, error: error.message };
  }
}

/**
 * Check if voice is enabled for wallet
 */
export function isVoiceEnabled(walletAddress: string): boolean {
  const stored = getStoredFingerprints();
  return !!stored[walletAddress];
}

/**
 * Remove voice enrollment
 */
export function removeVoiceEnrollment(walletAddress: string): void {
  const stored = getStoredFingerprints();
  delete stored[walletAddress];
  localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(stored));
}
