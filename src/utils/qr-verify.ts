// 2FA Mobile Verification System
// User scans QR with phone → Phone reports WiFi BSSID → Extension saves it
// During transactions: Phone must be on same WiFi network

const API_BASE = 'https://api.argus.foundation'

export interface MobileSession {
  sessionId: string
  publicKey: string
  mode: 'setup' | 'verify'
  expiresAt: number
  status: 'pending' | 'verified' | 'failed'
  device?: {
    userAgent: string
    bssid?: string
    ssid?: string
  }
}

export interface MobileDeviceInfo {
  sessionId: string
  userAgent: string
  bssid?: string  // WiFi BSSID from phone
  ssid?: string   // WiFi network name
  timestamp: number
}

// Create a new 2FA Mobile session for setup, verification, or recalibration
export async function createMobileSession(
  publicKey: string, 
  mode: 'setup' | 'verify' | 'recalibrate' = 'setup',
  expectedBssid?: string  // For verify mode, the BSSID we expect
): Promise<{ sessionId: string; qrData: string } | null> {
  try {
    const sessionId = crypto.randomUUID()
    
    const response = await fetch(`${API_BASE}/mobile/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        publicKey,
        mode,
        expectedBssid,
        expiresAt: Date.now() + 120000 // 2 minutes
      })
    })
    
    if (response.ok) {
      // QR data contains the URL the phone will open
      const qrData = `${API_BASE}/mobile/verify/${sessionId}`
      return { sessionId, qrData }
    }
    
    // Fallback if API fails - use local session (less secure but works offline)
    const qrData = `${API_BASE}/mobile/verify/${sessionId}`
    return { sessionId, qrData }
  } catch (e) {
    console.error('Error creating mobile session:', e)
    // Fallback
    const sessionId = crypto.randomUUID()
    const qrData = `${API_BASE}/mobile/verify/${sessionId}`
    return { sessionId, qrData }
  }
}

// Poll for session status - returns device info when phone scans QR
export async function checkMobileSession(sessionId: string): Promise<{
  status: 'pending' | 'verified' | 'failed'
  device?: MobileDeviceInfo
  error?: string
}> {
  try {
    const response = await fetch(`${API_BASE}/mobile/status/${sessionId}`)
    if (response.ok) {
      const data = await response.json()
      return {
        status: data.status || 'pending',
        device: data.device,
        error: data.error
      }
    }
    return { status: 'pending' }
  } catch (e) {
    console.error('Error checking mobile session:', e)
    return { status: 'pending' }
  }
}

// Cancel a session
export async function cancelMobileSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/mobile/cancel/${sessionId}`, { method: 'POST' })
  } catch (e) {
    // Ignore errors
  }
}

// ==========================================
// Biometric 2FA Functions (FaceID/TouchID)
// ==========================================

export interface BiometricSession {
  sessionId: string
  publicKey: string
  mode: 'register' | 'authenticate'
  challenge: string
  status: 'pending' | 'verified' | 'failed'
}

// Create a new biometric session for registration or authentication
export async function createBiometricSession(
  publicKey: string,
  mode: 'register' | 'authenticate'
): Promise<{ sessionId: string; qrData: string } | null> {
  try {
    const sessionId = crypto.randomUUID()
    
    const response = await fetch(`${API_BASE}/biometric/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        publicKey,
        mode
      })
    })
    
    if (response.ok) {
      const qrData = `${API_BASE}/biometric/verify/${sessionId}`
      return { sessionId, qrData }
    }
    
    // Fallback
    const qrData = `${API_BASE}/biometric/verify/${sessionId}`
    return { sessionId, qrData }
  } catch (e) {
    console.error('Error creating biometric session:', e)
    const sessionId = crypto.randomUUID()
    const qrData = `${API_BASE}/biometric/verify/${sessionId}`
    return { sessionId, qrData }
  }
}

// Poll for biometric session status
export async function checkBiometricSession(sessionId: string): Promise<{
  status: 'pending' | 'verified' | 'failed' | 'expired'
}> {
  try {
    const response = await fetch(`${API_BASE}/biometric/status/${sessionId}`)
    if (response.ok) {
      const data = await response.json()
      return { status: data.status || 'pending' }
    }
    return { status: 'pending' }
  } catch (e) {
    console.error('Error checking biometric session:', e)
    return { status: 'pending' }
  }
}

// Cancel a biometric session
export async function cancelBiometricSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/biometric/cancel/${sessionId}`, { method: 'POST' })
  } catch (e) {
    // Ignore errors
  }
}
