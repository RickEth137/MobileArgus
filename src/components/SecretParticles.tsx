import React, { useEffect, useRef } from 'react'

interface SecretParticlesProps {
  width?: number
  height?: number
}

const SecretParticles: React.FC<SecretParticlesProps> = ({ 
  width = 260, 
  height = 50 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Particle system
    const particles: Array<{
      x: number
      y: number
      size: number
      speedX: number
      speedY: number
      opacity: number
      opacitySpeed: number
      drift: number
    }> = []

    const particleCount = 40

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.2 - 0.1, // slight upward drift
        opacity: Math.random() * 0.6 + 0.2,
        opacitySpeed: (Math.random() - 0.5) * 0.01,
        drift: Math.random() * Math.PI * 2
      })
    }

    let animationId: number
    let time = 0

    const animate = () => {
      ctx.clearRect(0, 0, width, height)
      time += 0.02

      particles.forEach((p, i) => {
        // Update position with gentle sine wave drift
        p.x += p.speedX + Math.sin(time + p.drift) * 0.15
        p.y += p.speedY + Math.cos(time * 0.7 + p.drift) * 0.1

        // Update opacity (breathing effect)
        p.opacity += p.opacitySpeed
        if (p.opacity > 0.8 || p.opacity < 0.15) {
          p.opacitySpeed *= -1
        }

        // Wrap around edges
        if (p.x < -5) p.x = width + 5
        if (p.x > width + 5) p.x = -5
        if (p.y < -5) p.y = height + 5
        if (p.y > height + 5) p.y = -5

        // Draw particle with glow
        ctx.beginPath()
        
        // Outer glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
        gradient.addColorStop(0, `rgba(255, 255, 255, ${p.opacity * 0.8})`)
        gradient.addColorStop(0.4, `rgba(255, 255, 255, ${p.opacity * 0.3})`)
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        
        ctx.fillStyle = gradient
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
        ctx.fill()

        // Core
        ctx.beginPath()
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      })

      // Draw some connecting lines between close particles (subtle magic effect)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
      ctx.lineWidth = 0.5
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          
          if (dist < 30) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1
      }}
    />
  )
}

export default SecretParticles
