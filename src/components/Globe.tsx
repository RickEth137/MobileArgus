"use client"

import { useEffect, useRef, memo, useState } from "react"
import createGlobe, { type COBEOptions } from "cobe"
import { useSpring } from "motion/react"

const MOVEMENT_DAMPING = 1400

const GLOBE_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  onRender: () => {},
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.3,
  dark: 1, // Dark mode for our dark theme
  diffuse: 0.4,
  mapSamples: 16000,
  mapBrightness: 6,
  baseColor: [0.07, 0.07, 0.09], // Dark base matching our #121216
  markerColor: [0.063, 0.725, 0.506], // #10b981 green
  glowColor: [0.1, 0.1, 0.12],
  markers: [
    // Major cities around the world
    { location: [14.5995, 120.9842], size: 0.03 }, // Manila
    { location: [19.076, 72.8777], size: 0.1 }, // Mumbai
    { location: [23.8103, 90.4125], size: 0.05 }, // Dhaka
    { location: [30.0444, 31.2357], size: 0.07 }, // Cairo
    { location: [39.9042, 116.4074], size: 0.08 }, // Beijing
    { location: [-23.5505, -46.6333], size: 0.1 }, // São Paulo
    { location: [19.4326, -99.1332], size: 0.1 }, // Mexico City
    { location: [40.7128, -74.006], size: 0.1 }, // New York
    { location: [34.6937, 135.5022], size: 0.05 }, // Osaka
    { location: [41.0082, 28.9784], size: 0.06 }, // Istanbul
    { location: [51.5074, -0.1278], size: 0.08 }, // London
    { location: [48.8566, 2.3522], size: 0.07 }, // Paris
    { location: [35.6762, 139.6503], size: 0.08 }, // Tokyo
    { location: [-33.8688, 151.2093], size: 0.06 }, // Sydney
    { location: [55.7558, 37.6173], size: 0.07 }, // Moscow
  ],
}

interface GlobeProps {
  className?: string
  config?: Partial<COBEOptions>
  activated?: boolean
  showLockIcon?: boolean
}

// Memoized Globe component - prevents re-renders from parent state changes
const GlobeComponent = memo(function GlobeComponent({ className, config = {}, activated = false, showLockIcon = true }: GlobeProps) {
  const phiRef = useRef(0)
  const widthRef = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerInteracting = useRef<number | null>(null)
  const pointerInteractionMovement = useRef(0)
  const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null)
  const [showLock, setShowLock] = useState(false)

  const r = useSpring(0, {
    mass: 1,
    damping: 30,
    stiffness: 100,
  })

  // Trigger lock animation after glow starts
  useEffect(() => {
    if (activated && showLockIcon) {
      const timer = setTimeout(() => setShowLock(true), 400)
      return () => clearTimeout(timer)
    } else {
      setShowLock(false)
    }
  }, [activated, showLockIcon])

  const updatePointerInteraction = (value: number | null) => {
    pointerInteracting.current = value
    if (canvasRef.current) {
      canvasRef.current.style.cursor = value !== null ? "grabbing" : "grab"
    }
  }

  const updateMovement = (clientX: number) => {
    if (pointerInteracting.current !== null) {
      const delta = clientX - pointerInteracting.current
      pointerInteractionMovement.current = delta
      r.set(r.get() + delta / MOVEMENT_DAMPING)
    }
  }

  useEffect(() => {
    if (!canvasRef.current || globeRef.current) return // Don't recreate if already exists

    const onResize = () => {
      if (canvasRef.current) {
        widthRef.current = canvasRef.current.offsetWidth
      }
    }

    window.addEventListener("resize", onResize)
    onResize()

    const mergedConfig = { ...GLOBE_CONFIG, ...config }

    globeRef.current = createGlobe(canvasRef.current!, {
      ...mergedConfig,
      width: widthRef.current * 2,
      height: widthRef.current * 2,
      onRender: (state) => {
        if (!pointerInteracting.current) phiRef.current += 0.005
        state.phi = phiRef.current + r.get()
        state.width = widthRef.current * 2
        state.height = widthRef.current * 2
      },
    })

    setTimeout(() => {
      if (canvasRef.current) {
        canvasRef.current.style.opacity = "1"
      }
    }, 0)
    
    return () => {
      if (globeRef.current) {
        globeRef.current.destroy()
        globeRef.current = null
      }
      window.removeEventListener("resize", onResize)
    }
  }, []) // Empty dependency array - only run once on mount

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        margin: '0 auto',
        aspectRatio: '1/1',
        width: '100%',
        maxWidth: 600,
        ...(className ? {} : {})
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: 0,
          transition: 'opacity 500ms ease, filter 1.2s ease-out',
          contain: 'layout paint size',
          cursor: 'grab',
          filter: activated ? 'hue-rotate(-10deg) saturate(1.5) brightness(1.2)' : 'none'
        }}
        onPointerDown={(e) => {
          pointerInteracting.current = e.clientX
          updatePointerInteraction(e.clientX)
        }}
        onPointerUp={() => updatePointerInteraction(null)}
        onPointerOut={() => updatePointerInteraction(null)}
        onMouseMove={(e) => updateMovement(e.clientX)}
        onTouchMove={(e) =>
          e.touches[0] && updateMovement(e.touches[0].clientX)
        }
      />
      
      {/* Activation glow overlay - fades in smoothly */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.25) 0%, rgba(16, 185, 129, 0.08) 40%, transparent 65%)',
          pointerEvents: 'none',
          opacity: activated ? 1 : 0,
          transition: 'opacity 1.2s ease-out',
        }}
      />

      {/* Lock icon - appears on activation */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: showLock ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.3)',
          opacity: showLock ? 1 : 0,
          transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
          pointerEvents: 'none',
          zIndex: 10
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.15)',
            backdropFilter: 'blur(8px)',
            border: '2px solid rgba(16, 185, 129, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 40px rgba(16, 185, 129, 0.3), inset 0 0 20px rgba(16, 185, 129, 0.1)',
            animation: showLock ? 'lockAppearAndPulse 3s ease-out forwards' : 'none'
          }}
        >
          {/* Custom animated lock SVG */}
          <svg 
            width="36" 
            height="36" 
            viewBox="0 0 24 24" 
            fill="none" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))',
              overflow: 'visible'
            }}
          >
            {/* Lock body - stays in place */}
            <rect 
              x="3" 
              y="11" 
              width="18" 
              height="11" 
              rx="2" 
              ry="2" 
              stroke="#10b981"
            />
            
            {/* Shackle - animates from open to closed */}
            <path 
              d="M7 11V7a5 5 0 0 1 10 0v4"
              stroke="#10b981"
              style={{
                transformOrigin: '12px 11px',
                animation: showLock ? 'shackleLock 1.2s ease-out 0.5s forwards' : 'none',
                transform: 'translateY(-4px) rotate(30deg)'
              }}
            />
            
            {/* Keyhole - fades in after lock */}
            <circle 
              cx="12" 
              cy="16" 
              r="1.5" 
              fill="#10b981"
              style={{
                opacity: 0,
                animation: showLock ? 'keyholeAppear 0.4s ease-out 1.5s forwards' : 'none'
              }}
            />
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes lockAppearAndPulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 40px rgba(16, 185, 129, 0.3), inset 0 0 20px rgba(16, 185, 129, 0.1);
          }
          /* Hold at normal size while shackle animates */
          50% {
            transform: scale(1);
            box-shadow: 0 0 40px rgba(16, 185, 129, 0.3), inset 0 0 20px rgba(16, 185, 129, 0.1);
          }
          /* Scale up when lock clicks into place */
          65% {
            transform: scale(1.25);
            box-shadow: 0 0 80px rgba(16, 185, 129, 0.6), inset 0 0 30px rgba(16, 185, 129, 0.2);
          }
          /* Settle back slightly */
          80% {
            transform: scale(1.15);
            box-shadow: 0 0 60px rgba(16, 185, 129, 0.5), inset 0 0 25px rgba(16, 185, 129, 0.15);
          }
          /* Final resting state - slightly larger */
          100% {
            transform: scale(1.1);
            box-shadow: 0 0 50px rgba(16, 185, 129, 0.4), inset 0 0 22px rgba(16, 185, 129, 0.12);
          }
        }
        
        @keyframes shackleLock {
          0% {
            transform: translateY(-4px) rotate(30deg);
          }
          70% {
            transform: translateY(0px) rotate(0deg);
          }
          85% {
            transform: translateY(2px) rotate(0deg);
          }
          100% {
            transform: translateY(0px) rotate(0deg);
          }
        }
        
        @keyframes keyholeAppear {
          0% {
            opacity: 0;
            transform: scale(0);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  )
})

// Export the memoized component
export { GlobeComponent as Globe }
export default GlobeComponent
