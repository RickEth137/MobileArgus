import React, { useState } from 'react';

interface ComingSoonWrapperProps {
  children: React.ReactNode;
  enabled: boolean;
  message?: string;
  style?: React.CSSProperties;
}

/**
 * Wraps a component with a "Coming Soon" tooltip when the feature is disabled.
 * When disabled, the component is greyed out and shows a tooltip on hover.
 */
export const ComingSoonWrapper: React.FC<ComingSoonWrapperProps> = ({ 
  children, 
  enabled, 
  message = "Coming Soon",
  style 
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (enabled) {
    return <>{children}</>;
  }

  return (
    <div 
      style={{ 
        position: 'relative', 
        opacity: 0.4, 
        cursor: 'default',
        ...style 
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Overlay to block clicks */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        cursor: 'default'
      }} />
      
      {/* The actual component (greyed out) */}
      <div style={{ pointerEvents: 'none' }}>
        {children}
      </div>
      
      {/* Coming Soon Tooltip */}
      {showTooltip && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '10px 16px',
          background: 'linear-gradient(135deg, rgba(30, 30, 40, 0.98) 0%, rgba(20, 20, 30, 0.98) 100%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 10,
          fontSize: 12,
          fontWeight: 600,
          color: '#a78bfa',
          whiteSpace: 'nowrap',
          zIndex: 9999,
          boxShadow: '0 8px 32px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          animation: 'fadeIn 0.2s ease'
        }}>
          {/* Sparkle icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          {message}
        </div>
      )}
    </div>
  );
};

/**
 * A simple "Coming Soon" badge to display inline
 */
export const ComingSoonBadge: React.FC<{ message?: string }> = ({ message = "Soon" }) => (
  <span style={{
    padding: '2px 6px',
    background: 'rgba(139, 92, 246, 0.15)',
    border: '1px solid rgba(139, 92, 246, 0.25)',
    borderRadius: 4,
    fontSize: 8,
    fontWeight: 600,
    color: '#a78bfa',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px'
  }}>
    {message}
  </span>
);

export default ComingSoonWrapper;
