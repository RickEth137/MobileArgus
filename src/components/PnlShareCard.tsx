import { useRef } from "react"

interface PnlShareCardProps {
  tokenName: string
  tokenSymbol: string
  tokenLogo?: string
  invested: number // SOL invested
  position: number // Current position value in SOL
  pnlSol: number // Profit/Loss in SOL
  pnlPercent: number // Profit/Loss percentage
  pnlUsd: number // Profit/Loss in USD
  investedUsd: number // Invested in USD
  positionUsd: number // Position in USD
  onClose: () => void
  onDownload: () => void
  onShare?: () => void
}

export function PnlShareCard({
  tokenName,
  tokenSymbol,
  tokenLogo,
  invested,
  position,
  pnlSol,
  pnlPercent,
  pnlUsd,
  investedUsd,
  positionUsd,
  onClose,
  onDownload,
  onShare
}: PnlShareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  
  const isProfit = pnlSol >= 0

  const formatNumber = (n: number, decimals = 2) => {
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(2) + 'K'
    return n.toFixed(decimals)
  }

  const handleDownload = async () => {
    const card = cardRef.current
    if (!card) return

    try {
      // Dynamic import html2canvas
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(card, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false
      })
      
      const link = document.createElement('a')
      link.download = `${tokenSymbol}-pnl-argus.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      onDownload()
    } catch (e) {
      console.error('Failed to download:', e)
      // Fallback - just close
      onDownload()
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${tokenSymbol} PNL - ARGUS`,
          text: `${isProfit ? '🟢' : '🔴'} ${tokenSymbol} ${isProfit ? '+' : ''}${pnlPercent.toFixed(1)}% (${isProfit ? '+' : ''}${formatNumber(pnlSol)} SOL) on @ArgusProtocol`,
          url: 'https://argus.app'
        })
      } catch (e) {
        console.log('Share cancelled')
      }
    }
    onShare?.()
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: 20
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          borderRadius: 8,
          width: 36,
          height: 36,
          color: '#fff',
          cursor: 'pointer',
          fontSize: 18
        }}
      >
        ✕
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        {/* The Card */}
        <div
          ref={cardRef}
          style={{
            width: 340,
            background: '#080810',
            borderRadius: 20,
            padding: 24,
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          {/* Background Image */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'url(https://brown-traditional-sheep-998.mypinata.cloud/ipfs/bafybeihvxbmsjdrke2zreawhqiive6ijejojuqrfzm45dotara67xn2y5a)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.6,
            pointerEvents: 'none'
          }} />
          
          {/* Dark overlay for readability */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(180deg, rgba(8, 8, 16, 0.7) 0%, rgba(8, 8, 16, 0.85) 100%)',
            pointerEvents: 'none'
          }} />

          {/* Header */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 20,
            position: 'relative'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img 
                src="/assets/arguslogo.png"
                alt="ARGUS"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  objectFit: 'contain'
                }}
              />
              <span style={{ 
                fontSize: 14, 
                fontWeight: 700, 
                color: '#fff',
                letterSpacing: '0.5px'
              }}>
                ARGUS
              </span>
            </div>
            <span style={{ 
              fontSize: 10, 
              color: 'rgba(255, 255, 255, 0.4)',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '4px 8px',
              borderRadius: 6
            }}>
              argus.gg
            </span>
          </div>

          {/* Token Info */}
          <div style={{ marginBottom: 16, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {tokenLogo ? (
                <img 
                  src={tokenLogo} 
                  alt={tokenSymbol}
                  style={{ width: 32, height: 32, borderRadius: 8 }}
                  crossOrigin="anonymous"
                />
              ) : (
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(16, 185, 129, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  color: '#10b981'
                }}>
                  {tokenSymbol?.charAt(0)}
                </div>
              )}
              <span style={{ 
                fontSize: 20, 
                fontWeight: 600, 
                color: '#fff'
              }}>
                {tokenName || tokenSymbol}
              </span>
            </div>
          </div>

          {/* Big PNL Number */}
          <div style={{ marginBottom: 24, position: 'relative' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8,
              marginBottom: 4
            }}>
              <img 
                src="https://assets.coingecko.com/coins/images/4128/standard/solana.png"
                alt="SOL"
                style={{ width: 20, height: 20, borderRadius: '50%' }}
                crossOrigin="anonymous"
              />
              <span style={{ 
                fontSize: 42, 
                fontWeight: 700, 
                color: isProfit ? '#10b981' : '#ef4444',
                lineHeight: 1
              }}>
                {isProfit ? '+' : ''}{formatNumber(pnlSol)}
              </span>
            </div>
            <div style={{ 
              fontSize: 14, 
              color: 'rgba(255, 255, 255, 0.5)',
              marginLeft: 24
            }}>
              {isProfit ? '+' : ''}${formatNumber(pnlUsd)} USD
            </div>
          </div>

          {/* Stats Row */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            position: 'relative'
          }}>
            {/* Invested */}
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginBottom: 4 }}>
                Invested
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <img 
                  src="https://assets.coingecko.com/coins/images/4128/standard/solana.png"
                  alt="SOL"
                  style={{ width: 14, height: 14, borderRadius: '50%' }}
                  crossOrigin="anonymous"
                />
                <span style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
                  {formatNumber(invested)}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.3)' }}>
                (${formatNumber(investedUsd)} USD)
              </div>
            </div>

            {/* Position */}
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginBottom: 4 }}>
                Position
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <img 
                  src="https://assets.coingecko.com/coins/images/4128/standard/solana.png"
                  alt="SOL"
                  style={{ width: 14, height: 14, borderRadius: '50%' }}
                  crossOrigin="anonymous"
                />
                <span style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
                  {formatNumber(position)}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.3)' }}>
                (${formatNumber(positionUsd)} USD)
              </div>
            </div>

            {/* PNL */}
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)', marginBottom: 4 }}>
                PNL
              </div>
              <div style={{ 
                fontSize: 18, 
                fontWeight: 700, 
                color: isProfit ? '#10b981' : '#ef4444'
              }}>
                {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: isProfit ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)' }}>
                ({isProfit ? '+' : ''}${formatNumber(pnlUsd)} USD)
              </div>
            </div>
          </div>

          {/* Bottom accent line */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: isProfit 
              ? 'linear-gradient(90deg, transparent, #10b981, transparent)'
              : 'linear-gradient(90deg, transparent, #ef4444, transparent)'
          }} />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleDownload}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              borderRadius: 10,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </button>
          
          {navigator.share && (
            <button
              onClick={handleShare}
              style={{
                padding: '12px 24px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
