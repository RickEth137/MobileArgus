import React from "react"

interface PlanetAvatarProps {
  seed: string
  size?: number
}

function seededRandom(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    hash = hash & hash
  }
  return () => {
    hash = Math.sin(hash) * 10000
    return hash - Math.floor(hash)
  }
}

export const PlanetAvatar: React.FC<PlanetAvatarProps> = ({ seed, size = 40 }) => {
  const rand = seededRandom(seed)
  const id = `p${seed.slice(0,6)}`
  const r = size * 0.48
  const cx = size / 2
  const cy = size / 2
  
  // Planet type determines color palette
  const types = [
    { base: '#4a7c9b', mid: '#3d6a87', dark: '#2c4a5e', name: 'neptune' },
    { base: '#7fb8d8', mid: '#5a9fc4', dark: '#3d7a9e', name: 'uranus' },
    { base: '#c4a574', mid: '#a8895d', dark: '#7d6442', name: 'jupiter' },
    { base: '#d4b896', mid: '#c4a67a', dark: '#9e8255', name: 'saturn' },
    { base: '#c67b5c', mid: '#a65d42', dark: '#7a4230', name: 'mars' },
    { base: '#8a8a8a', mid: '#6e6e6e', dark: '#4a4a4a', name: 'mercury' },
    { base: '#6b93b8', mid: '#4a7294', dark: '#2d4a5e', name: 'earth' },
    { base: '#d4956a', mid: '#b87a4d', dark: '#8a5a38', name: 'titan' },
  ]
  
  const planet = types[Math.floor(rand() * types.length)]
  const noiseFreq = 0.02 + rand() * 0.03
  const seedNum = seed.charCodeAt(0) + seed.charCodeAt(1)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <defs>
        {/* Planet surface texture */}
        <filter id={`${id}tex`} x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence 
            type="fractalNoise" 
            baseFrequency={noiseFreq}
            numOctaves="5" 
            seed={seedNum}
            result="noise"
          />
          <feColorMatrix
            type="matrix"
            in="noise"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 8 -3"
            result="contrast"
          />
          <feComposite in="SourceGraphic" in2="contrast" operator="in" result="masked"/>
          <feBlend in="masked" in2="contrast" mode="overlay"/>
        </filter>
        
        {/* Spherical shading */}
        <radialGradient id={`${id}shade`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
          <stop offset="40%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </radialGradient>
        
        {/* Edge darkening */}
        <radialGradient id={`${id}edge`} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="rgba(0,0,0,0)" />
          <stop offset="85%" stopColor="rgba(0,0,0,0.2)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
        </radialGradient>
        
        {/* Atmosphere */}
        <radialGradient id={`${id}atm`} cx="50%" cy="50%" r="52%">
          <stop offset="90%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor={`${planet.base}40`} />
        </radialGradient>
        
        <clipPath id={`${id}clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      
      {/* Space */}
      <rect width={size} height={size} fill="#0a0a0c" />
      
      {/* Planet base color */}
      <circle cx={cx} cy={cy} r={r} fill={planet.mid} />
      
      {/* Planet surface with texture */}
      <g clipPath={`url(#${id}clip)`}>
        <circle 
          cx={cx} 
          cy={cy} 
          r={r * 1.5}
          fill={planet.base}
          filter={`url(#${id}tex)`}
        />
        
        {/* Color bands for gas giants */}
        {(planet.name === 'jupiter' || planet.name === 'saturn' || planet.name === 'neptune') && (
          <g opacity="0.3">
            {[0.25, 0.4, 0.55, 0.7, 0.85].map((y, i) => (
              <rect
                key={i}
                x={cx - r * 1.5}
                y={cy - r + (r * 2 * y) - r * 0.04}
                width={r * 3}
                height={r * 0.08}
                fill={i % 2 === 0 ? planet.dark : planet.base}
                opacity={0.4 + rand() * 0.3}
              />
            ))}
          </g>
        )}
      </g>
      
      {/* Spherical shading */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}shade)`} />
      
      {/* Edge darkening */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}edge)`} />
      
      {/* Thin atmosphere glow */}
      <circle cx={cx} cy={cy} r={r + 1} fill={`url(#${id}atm)`} />
    </svg>
  )
}

export default PlanetAvatar
