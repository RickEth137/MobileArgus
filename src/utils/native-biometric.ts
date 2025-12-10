/**
 * Native Biometric Authentication for ARGUS Mobile
 * Uses WebAuthn API for Face ID / Touch ID on iOS and Android
 * No QR code flow needed - biometrics happen directly on device
 */

const BIOMETRIC_STORAGE_KEY = 'geovault_biometric_credentials';

export interface BiometricCredential {
  credentialId: string;
  publicKey: string;
  createdAt: number;
  deviceInfo: string;
}

/**
 * Check if WebAuthn/platform authenticator is available
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    console.log('[Biometric] WebAuthn not supported');
    return false;
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    console.log('[Biometric] Platform authenticator available:', available);
    return available;
  } catch (e) {
    console.error('[Biometric] Error checking availability:', e);
    return false;
  }
}

/**
 * Generate a random challenge for WebAuthn
 */
function generateChallenge(): Uint8Array {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Get stored credentials for a wallet
 */
function getStoredCredentials(): Record<string, BiometricCredential> {
  try {
    const stored = localStorage.getItem(BIOMETRIC_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Save credential for a wallet
 */
function saveCredential(walletAddress: string, credential: BiometricCredential): void {
  const stored = getStoredCredentials();
  stored[walletAddress] = credential;
  localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(stored));
}

/**
 * Check if biometric is enrolled for a wallet
 */
export function isBiometricEnrolled(walletAddress: string): boolean {
  const stored = getStoredCredentials();
  return !!stored[walletAddress];
}

/**
 * Get biometric credential for a wallet
 */
export function getBiometricCredential(walletAddress: string): BiometricCredential | null {
  const stored = getStoredCredentials();
  return stored[walletAddress] || null;
}

/**
 * Enroll biometric (Face ID / Touch ID) for a wallet
 * Creates a new WebAuthn credential bound to this device
 */
export async function enrollBiometric(walletAddress: string): Promise<{
  success: boolean;
  credentialId?: string;
  error?: string;
}> {
  try {
    const available = await isBiometricAvailable();
    if (!available) {
      return { success: false, error: 'Biometric authentication not available on this device' };
    }

    const challenge = generateChallenge();
    
    // Create credential options for platform authenticator (Face ID / Touch ID)
    const createCredentialOptions: CredentialCreationOptions = {
      publicKey: {
        challenge,
        rp: {
          name: 'GeoVault',
          id: window.location.hostname,
        },
        user: {
          id: new TextEncoder().encode(walletAddress),
          name: walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4),
          displayName: 'GeoVault Wallet',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Forces Face ID / Touch ID
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    };

    console.log('[Biometric] Creating credential...');
    const credential = await navigator.credentials.create(createCredentialOptions) as PublicKeyCredential;
    
    if (!credential) {
      return { success: false, error: 'Failed to create biometric credential' };
    }

    const response = credential.response as AuthenticatorAttestationResponse;
    const credentialId = arrayBufferToBase64(credential.rawId);
    const publicKey = arrayBufferToBase64(response.getPublicKey() || new ArrayBuffer(0));

    // Save credential
    saveCredential(walletAddress, {
      credentialId,
      publicKey,
      createdAt: Date.now(),
      deviceInfo: navigator.userAgent,
    });

    console.log('[Biometric] Enrollment successful');
    return { success: true, credentialId };

  } catch (e: any) {
    console.error('[Biometric] Enrollment error:', e);
    
    if (e.name === 'NotAllowedError') {
      return { success: false, error: 'Biometric authentication was cancelled or denied' };
    }
    if (e.name === 'SecurityError') {
      return { success: false, error: 'Security error - please ensure you are on HTTPS' };
    }
    
    return { success: false, error: e.message || 'Biometric enrollment failed' };
  }
}

/**
 * Verify biometric (Face ID / Touch ID) for a transaction
 * Prompts user to authenticate with their face/fingerprint
 */
export async function verifyBiometric(walletAddress: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const credential = getBiometricCredential(walletAddress);
    if (!credential) {
      return { success: false, error: 'No biometric enrolled for this wallet' };
    }

    const challenge = generateChallenge();

    // Get credential options for authentication
    const getCredentialOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{
          type: 'public-key',
          id: base64ToArrayBuffer(credential.credentialId),
          transports: ['internal'], // Platform authenticator
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    };

    console.log('[Biometric] Requesting authentication...');
    const assertion = await navigator.credentials.get(getCredentialOptions) as PublicKeyCredential;

    if (!assertion) {
      return { success: false, error: 'Biometric authentication failed' };
    }

    console.log('[Biometric] Authentication successful');
    return { success: true };

  } catch (e: any) {
    console.error('[Biometric] Verification error:', e);
    
    if (e.name === 'NotAllowedError') {
      return { success: false, error: 'Biometric authentication was cancelled or denied' };
    }
    if (e.name === 'SecurityError') {
      return { success: false, error: 'Security error - please ensure you are on HTTPS' };
    }
    
    return { success: false, error: e.message || 'Biometric verification failed' };
  }
}

/**
 * Remove biometric enrollment for a wallet
 */
export function removeBiometric(walletAddress: string): void {
  const stored = getStoredCredentials();
  delete stored[walletAddress];
  localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(stored));
}
