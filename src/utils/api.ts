// API Client for ARGUS Vault Backend

const API_URL = "https://argus-api-gpcu.onrender.com";

export const getServerConfig = async () => {
    const res = await fetch(`${API_URL}/config`);
    if (!res.ok) throw new Error("Failed to fetch server config");
    return await res.json();
};

export const registerUser = async (walletPublicKey: string) => {
    const res = await fetch(`${API_URL}/register-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            walletPublicKey
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "User registration failed");
    return data;
};

export const activateGeoGuard = async (
    walletPublicKey: string,
    location: { latitude: number; longitude: number },
    geoRange: number = 0.5,
    usbDevice?: { vendorId: number; productId: number; serialNumber: string; productName: string } | null
) => {
    const res = await fetch(`${API_URL}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            walletPublicKey,
            location,
            geoRange,
            usbDevice
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Activation failed");
    return data;
};

export const registerVault = async (
    walletPublicKey: string,
    multisigPda: string,
    vaultPda: string
) => {
    const res = await fetch(`${API_URL}/register-vault`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            walletPublicKey,
            multisigPda,
            vaultPda
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Vault registration failed");
    return data;
};

export const checkVaultExists = async (walletPublicKey: string) => {
    const res = await fetch(`${API_URL}/vault/${walletPublicKey}`);
    if (!res.ok) return null;
    return await res.json();
};

export const getHomeLocation = async (walletPublicKey: string) => {
    const res = await fetch(`${API_URL}/home-location/${walletPublicKey}`);
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to get home location");
    }
    return await res.json();
};

export const updateHomeLocation = async (
    walletPublicKey: string,
    latitude: number,
    longitude: number
) => {
    const res = await fetch(`${API_URL}/update-home-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletPublicKey, latitude, longitude })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update home location");
    return data;
};

// Custom error class for geo-fence errors
export class GeoFenceError extends Error {
    geoError: boolean = true;
    distance: number;
    requiredRange: number;
    
    constructor(message: string, distance: number, requiredRange: number) {
        super(message);
        this.name = 'GeoFenceError';
        this.distance = distance;
        this.requiredRange = requiredRange;
    }
}

export const requestServerApproval = async (
    multisigPda: string,
    walletPublicKey: string,
    transactionIndex: string,
    location: { latitude: number; longitude: number; accuracy?: number }
) => {
    const res = await fetch(`${API_URL}/approve-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            multisigPda,
            walletPublicKey,
            transactionIndex,
            location // Now includes accuracy if available
        })
    });

    const data = await res.json();
    if (!res.ok) {
        // Check if this is a geo-fence error with distance data
        if (data.geoError && data.distance !== undefined) {
            throw new GeoFenceError(data.error || "Geo-fence verification failed", data.distance, data.requiredRange || 0.5);
        }
        throw new Error(data.error || "Server approval failed");
    }
    return data;
};

export const getSecuritySettings = async (walletPublicKey: string) => {
    const res = await fetch(`${API_URL}/security/${walletPublicKey}`);
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch security settings");
    }
    return await res.json();
};

export const updateSecurityLayer = async (
    walletPublicKey: string,
    layer: 'wifi' | 'bluetooth' | 'usb' | 'biometric' | 'voice',
    enabled: boolean,
    deviceData?: any
) => {
    const res = await fetch(`${API_URL}/security/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            walletPublicKey,
            layer,
            enabled,
            deviceData
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update security settings");
    return data;
};

// ==========================================
// Server-Side Password Authentication
// ==========================================

// Set password for a wallet (called on wallet creation)
export const setServerPassword = async (publicKey: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, password })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to set password");
    return data;
};

// Verify password against server (called when disabling layers or importing)
export const verifyServerPassword = async (publicKey: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, password })
    });
    
    const data = await res.json();
    // Don't throw on 401 - just return the result
    return { success: data.success, hasPassword: data.hasPassword, error: data.error };
};

// Check if wallet has a password set on server
export const checkServerPassword = async (publicKey: string) => {
    const res = await fetch(`${API_URL}/auth/check/${publicKey}`);
    
    if (!res.ok) {
        return { hasPassword: false, exists: false };
    }
    
    return await res.json();
};

// Change password (requires old password verification)
export const changeServerPassword = async (publicKey: string, oldPassword: string, newPassword: string) => {
    const res = await fetch(`${API_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, oldPassword, newPassword })
    });
    
    const data = await res.json();
    return { success: data.success, error: data.error };
};

// ==========================================
// Currency Exchange Rates
// ==========================================

export interface ExchangeRates {
    USD: number;
    EUR: number;
    GBP: number;
    JPY: number;
    CNY: number;
    KRW: number;
    CAD: number;
    AUD: number;
    CHF: number;
    MXN: number;
    BRL: number;
    INR: number;
}

export const getExchangeRates = async (): Promise<ExchangeRates> => {
    const res = await fetch(`${API_URL}/exchange-rates`);
    
    if (!res.ok) {
        throw new Error("Failed to fetch exchange rates");
    }
    
    const data = await res.json();
    return data.rates;
};

// Currency symbols and names mapping
export const CURRENCY_INFO: Record<string, { symbol: string; name: string; code: string }> = {
    'United States Dollar': { symbol: '$', name: 'US Dollar', code: 'USD' },
    'Euro': { symbol: '€', name: 'Euro', code: 'EUR' },
    'British Pound': { symbol: '£', name: 'British Pound', code: 'GBP' },
    'Japanese Yen': { symbol: '¥', name: 'Japanese Yen', code: 'JPY' },
    'Chinese Yuan': { symbol: '¥', name: 'Chinese Yuan', code: 'CNY' },
    'Korean Won': { symbol: '₩', name: 'Korean Won', code: 'KRW' },
    'Canadian Dollar': { symbol: 'C$', name: 'Canadian Dollar', code: 'CAD' },
    'Australian Dollar': { symbol: 'A$', name: 'Australian Dollar', code: 'AUD' },
    'Swiss Franc': { symbol: 'CHF', name: 'Swiss Franc', code: 'CHF' },
    'Mexican Peso': { symbol: 'MX$', name: 'Mexican Peso', code: 'MXN' },
    'Brazilian Real': { symbol: 'R$', name: 'Brazilian Real', code: 'BRL' },
    'Indian Rupee': { symbol: '₹', name: 'Indian Rupee', code: 'INR' }
};

// ==========================================
// Voice Authentication
// ==========================================

// Enroll voice fingerprint for a wallet
export const enrollVoiceFingerprint = async (publicKey: string, fingerprint: string) => {
    const res = await fetch(`${API_URL}/auth/voice/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, fingerprint })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to enroll voice");
    return data;
};

// Get voice fingerprint for a wallet
export const getVoiceFingerprint = async (publicKey: string) => {
    const res = await fetch(`${API_URL}/auth/voice/${publicKey}`);
    
    if (!res.ok) {
        return { hasVoice: false, fingerprint: null };
    }
    
    return await res.json();
};

// Check if wallet has voice unlock enabled
export const checkVoiceEnabled = async (publicKey: string) => {
    const res = await fetch(`${API_URL}/auth/voice/check/${publicKey}`);
    
    if (!res.ok) {
        return { enabled: false };
    }
    
    return await res.json();
};

// Disable voice unlock for a wallet
export const disableVoiceAuth = async (publicKey: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/voice/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, password })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to disable voice auth");
    return data;
};
