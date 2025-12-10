import React, { useState, useEffect } from 'react';
import Globe from './Globe';
import { checkVoiceEnabled, getVoiceFingerprint } from '../utils/api';
import { verifyVoice } from '../utils/voice-auth';
import './UnlockScreen.css';

// Simple storage wrapper for web
const storage = {
  get: async <T,>(key: string): Promise<T | undefined> => {
    const value = localStorage.getItem(`geovault_${key}`);
    if (value) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    }
    return undefined;
  },
  set: async (key: string, value: any): Promise<void> => {
    localStorage.setItem(`geovault_${key}`, JSON.stringify(value));
  }
};

export default function UnlockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');

  // Check if voice unlock is enabled for this wallet
  useEffect(() => {
    const checkVoice = async () => {
      try {
        // Get wallet address using Plasmo storage (same as background.ts)
        const addr = await storage.get<string>("publicKey");
        console.log('[UnlockScreen] PublicKey from Plasmo storage:', addr);
        
        if (addr) {
          setWalletAddress(addr);
          
          const result = await checkVoiceEnabled(addr);
          console.log('[UnlockScreen] Voice check result:', result);
          setVoiceEnabled(result.enabled === true);
        } else {
          console.log('[UnlockScreen] No publicKey found in storage');
        }
      } catch (e) {
        console.log('[UnlockScreen] Voice check failed:', e);
      }
    };
    checkVoice();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Web version: verify password locally
      const storedHash = await storage.get<string>('password_hash');
      const inputHash = await hashPassword(password);
      
      if (storedHash === inputHash) {
        await storage.set('wallet_unlocked', true);
        onUnlock();
      } else {
        setError('Invalid password');
      }
    } catch (err) {
      setError('Failed to unlock wallet');
    } finally {
      setLoading(false);
    }
  };

  // Simple password hash for web
  const hashPassword = async (pwd: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pwd);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleVoiceUnlock = async () => {
    setError('');
    setIsRecording(true);
    
    try {
      console.log('[UnlockScreen] Getting fingerprint for wallet:', walletAddress);
      
      // Get stored fingerprint from server
      const fpResult = await getVoiceFingerprint(walletAddress);
      console.log('[UnlockScreen] Fingerprint result:', fpResult);
      
      if (!fpResult.fingerprint) {
        setError('Voice data not found. Please use password.');
        setIsRecording(false);
        return;
      }
      
      console.log('[UnlockScreen] Opening voice verification popup...');
      
      // Open voice verification popup
      const result = await verifyVoice(fpResult.fingerprint);
      console.log('[UnlockScreen] Verification result:', result);
      
      if (result.success) {
        // Web version: unlock directly on voice verification success
        await storage.set('wallet_unlocked', true);
        onUnlock();
      } else {
        setError(result.error || 'Voice not recognized');
      }
    } catch (err: any) {
      console.error('[UnlockScreen] Voice unlock error:', err);
      setError(err.message || 'Voice verification failed');
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <div className="unlock-container">
      {/* Top Header */}
      <div className="unlock-top-header">
        <span>ARGUS FOUNDATION</span>
      </div>

      {/* Globe Background */}
      <div className="unlock-globe-bg">
        <Globe className="unlock-globe" />
      </div>

      <div className="unlock-header">
        {/* Orbiting Logo */}
        <div className="unlock-logo">
          <img 
            src="/assets/arguslogo.png" 
            alt="ARGUS" 
            className="unlock-logo-img"
          />
          <div className="unlock-orbit-ring unlock-orbit-ring-inner"></div>
          <div className="unlock-orbit-ring unlock-orbit-ring-outer"></div>
          <div className="unlock-orbit unlock-orbit-inner">
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div className="unlock-orbit unlock-orbit-outer">
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <svg className="unlock-orbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </div>
        </div>
        <p className="unlock-subtitle">
          {voiceEnabled ? 'Use your voice to unlock' : 'Enter your password to unlock'}
        </p>
      </div>

      <form onSubmit={handleUnlock} className="unlock-form">
        {/* Show password field only if voice is NOT enabled, or if user wants to use password */}
        {!voiceEnabled && (
          <>
            <div className="input-group">
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !password}
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
          </>
        )}
        
        {voiceEnabled && (
          <>
            {error && <div className="error-message">{error}</div>}
            
            <button
              type="button"
              className="btn-primary voice-unlock-btn"
              onClick={handleVoiceUnlock}
              disabled={isRecording}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: isRecording ? 0.6 : 1
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              {isRecording ? 'Verifying...' : 'Unlock with Voice'}
            </button>
          </>
        )}
      </form>

      <div className="unlock-footer">
        {voiceEnabled ? (
          <a href="#" onClick={(e) => { e.preventDefault(); setVoiceEnabled(false); }}>
            Forgot passphrase? Unlock with password
          </a>
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); localStorage.clear(); window.location.reload(); }}>
            Forgot password? Reset wallet
          </a>
        )}
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes waveform {
          0% { transform: scaleY(0.3); opacity: 0.5; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
