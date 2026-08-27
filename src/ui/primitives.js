import React from 'react';
import { StarIcon } from './icons';
import { alpha, theme } from './theme';

const toneMap = {
  danger: { bg: alpha(theme.colors.danger, 0.12), border: alpha(theme.colors.danger, 0.18), color: theme.colors.danger },
  info: { bg: alpha(theme.colors.info, 0.12), border: alpha(theme.colors.info, 0.18), color: theme.colors.info },
  neutral: { bg: alpha(theme.colors.ink, 0.06), border: alpha(theme.colors.ink, 0.08), color: theme.colors.ink },
  success: { bg: alpha(theme.colors.success, 0.12), border: alpha(theme.colors.success, 0.18), color: theme.colors.success },
  warning: { bg: alpha(theme.colors.warning, 0.12), border: alpha(theme.colors.warning, 0.18), color: theme.colors.warning },
};

const buttonVariants = {
  danger: {
    background: theme.colors.danger,
    border: `1px solid ${theme.colors.danger}`,
    color: '#fff',
  },
  ghost: {
    background: 'transparent',
    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
    color: theme.colors.ink,
  },
  primary: {
    background: `var(--ui-primary-color, ${theme.colors.teal})`,
    border: `1px solid var(--ui-primary-color, ${theme.colors.teal})`,
    color: 'var(--ui-background-color, #ffffff)',
  },
  secondary: {
    background: alpha(theme.colors.panel, 0.86),
    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
    color: theme.colors.ink,
  },
};

export function Badge({ children, className, style, tone = 'neutral' }) {
  const colors = toneMap[tone] || toneMap.neutral;

  return (
    <span
      className={['ui-badge', className].filter(Boolean).join(' ')}
      style={{
        alignItems: 'center',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: theme.radius.pill,
        color: colors.color,
        display: 'inline-flex',
        fontSize: 12,
        fontWeight: 600,
        gap: 8,
        letterSpacing: '0.04em',
        minHeight: 32,
        padding: '0 12px',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Button({
  as,
  children,
  disabled = false,
  icon,
  style,
  type,
  variant = 'primary',
  ...rest
}) {
  const Component = as || 'button';
  const buttonStyle = buttonVariants[variant] || buttonVariants.primary;

  return (
    <Component
      {...rest}
      data-variant={variant}
      disabled={disabled}
      type={Component === 'button' ? type || 'button' : undefined}
      style={{
        alignItems: 'center',
        borderRadius: theme.radius.pill,
        boxShadow: variant === 'primary' && !disabled ? theme.shadows.button : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        fontFamily: theme.fonts.body,
        fontSize: 14,
        fontWeight: 600,
        gap: 10,
        justifyContent: 'center',
        lineHeight: 1,
        minHeight: 46,
        opacity: disabled ? 0.6 : 1,
        padding: '0 18px',
        textDecoration: 'none',
        transition: 'box-shadow 160ms ease, background 160ms ease',
        ...buttonStyle,
        ...style,
      }}
    >
      {icon ? <span style={{ display: 'inline-flex' }}>{icon}</span> : null}
      <span>{children}</span>
    </Component>
  );
}

export function Panel({ action, children, className, interactive = false, style, subtitle, title }) {
  const panelClassName = [interactive ? 'glass-panel interactive-panel' : 'glass-panel', className].filter(Boolean).join(' ');

  return (
    <section
      className={panelClassName}
      style={{
        borderRadius: theme.radius.sm,
        display: 'grid',
        gap: 18,
        padding: 24,
        ...style,
      }}
    >
      {title || subtitle || action ? (
        <div style={{ alignItems: subtitle ? 'flex-start' : 'center', display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' }}>
          <div style={{ display: 'grid', gap: 6, maxWidth: 760 }}>
            {title ? (
              <h2
                style={{
                  fontFamily: theme.fonts.display,
                  fontSize: 28,
                  letterSpacing: '-0.06em',
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                {title}
              </h2>
            ) : null}
            {subtitle ? <p style={{ color: theme.colors.slate, lineHeight: 1.7, margin: 0 }}>{subtitle}</p> : null}
          </div>
          {action ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({ detail, icon, label, style, tone = theme.colors.teal, value }) {
  return (
    <Panel
      interactive
      style={{
        alignContent: 'start',
        alignSelf: 'start',
        gap: 8,
        height: 'fit-content',
        minHeight: 0,
        padding: 16,
        ...style,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <div
          style={{
            alignItems: 'center',
            background: alpha(tone, 0.12),
            borderRadius: 14,
            color: tone,
            display: 'inline-flex',
            height: 36,
            justifyContent: 'center',
            width: 36,
          }}
        >
          {icon}
        </div>
        <span style={{ color: theme.colors.slate, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <strong
        style={{
          fontFamily: theme.fonts.display,
          fontSize: 20,
          letterSpacing: '-0.06em',
          lineHeight: 1.02,
        }}
      >
        {value}
      </strong>
      <p
        style={{
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          color: theme.colors.slate,
          display: '-webkit-box',
          fontSize: 13,
          lineHeight: 1.45,
          margin: 0,
          overflow: 'hidden',
        }}
      >
        {detail}
      </p>
    </Panel>
  );
}

export function SectionHeading({ description, eyebrow, title }) {
  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 820 }}>
      {eyebrow ? (
        <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{eyebrow}</span>
      ) : null}
      {title ? (
        <h2
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 'clamp(2rem, 4vw, 3.3rem)',
            letterSpacing: '-0.07em',
            lineHeight: 0.95,
            margin: 0,
          }}
        >
          {title}
        </h2>
      ) : null}
      {description ? <p style={{ color: theme.colors.slate, lineHeight: 1.75, margin: 0 }}>{description}</p> : null}
    </div>
  );
}

export function StarRating({ rating = 0, reviewCount = 0, size = 14, style, textStyle }) {
  const numericRating = Number(rating);
  const numericReviewCount = Number(reviewCount) || 0;
  const hasReviews = numericReviewCount > 0 && Number.isFinite(numericRating) && numericRating > 0;
  const filledStars = hasReviews ? Math.max(1, Math.min(5, Math.round(numericRating))) : 0;
  const label = hasReviews ? `${numericRating.toFixed(1)} (${numericReviewCount} review${numericReviewCount === 1 ? '' : 's'})` : 'No reviews yet';

  return (
    <div style={{ alignItems: 'center', display: 'inline-flex', gap: 8, ...style }}>
      <span style={{ alignItems: 'center', color: theme.colors.amber, display: 'inline-flex', gap: 4 }}>
        {Array.from({ length: 5 }).map((_, index) => (
          <StarIcon key={index} size={size} stroke={index < filledStars ? theme.colors.amber : alpha(theme.colors.amber, 0.22)} />
        ))}
      </span>
      <span
        style={{
          color: hasReviews ? theme.colors.ink : theme.colors.slate,
          fontSize: 13,
          fontWeight: hasReviews ? 600 : 500,
          lineHeight: 1.4,
          ...textStyle,
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function FormField({ children, hint, label, required }) {
  const hasRequiredControl = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.props.required,
  );
  const showRequired = required ?? hasRequiredControl;

  return (
    <label style={{ display: 'grid', gap: 10 }}>
      {label ? (
        <span
          style={{
            color: theme.colors.ink,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {label}
          {showRequired ? <span aria-hidden="true" style={{ color: theme.colors.danger, marginLeft: 4 }}>*</span> : null}
        </span>
      ) : null}
      {children}
      {hint ? <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>{hint}</span> : null}
    </label>
  );
}

function fieldBaseStyle(extra = {}) {
  return {
    background: alpha(theme.colors.panel, 0.92),
    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
    borderRadius: 18,
    color: theme.colors.ink,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    minHeight: 52,
    outline: 'none',
    padding: '0 16px',
    width: '100%',
    ...extra,
  };
}

export function Input(props) {
  return <input {...props} style={{ ...fieldBaseStyle(), ...(props.style || {}) }} />;
}

export function AuthInput({ action, icon, inputStyle, style, ...props }) {
  const gridTemplateColumns = [icon ? '20px' : null, 'minmax(0, 1fr)', action ? 'auto' : null].filter(Boolean).join(' ');

  return (
    <div
      style={{
        alignItems: 'center',
        background: '#ffffff',
        border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
        borderRadius: 20,
        boxShadow: '0 10px 28px rgba(24, 33, 46, 0.06)',
        display: 'grid',
        gap: 12,
        gridTemplateColumns,
        minHeight: 58,
        padding: '0 16px',
        width: '100%',
        ...style,
      }}
    >
      {icon ? <span style={{ color: theme.colors.muted, display: 'inline-flex' }}>{icon}</span> : null}
      <input
        {...props}
        style={{
          background: 'transparent',
          border: 0,
          color: theme.colors.ink,
          fontFamily: theme.fonts.body,
          fontSize: 15,
          minWidth: 0,
          outline: 'none',
          padding: 0,
          width: '100%',
          ...inputStyle,
        }}
      />
      {action ? <div style={{ display: 'inline-flex' }}>{action}</div> : null}
    </div>
  );
}

export function Textarea(props) {
  return (
    <textarea
      {...props}
      style={{
        ...fieldBaseStyle({
          minHeight: 132,
          padding: '14px 16px',
          resize: 'vertical',
        }),
        ...(props.style || {}),
      }}
    />
  );
}

export function FileInput(props) {
  return (
    <input
      {...props}
      style={{
        ...fieldBaseStyle({
          cursor: 'pointer',
          padding: 12,
        }),
        ...(props.style || {}),
      }}
      type="file"
    />
  );
}

export function StatusMessage({ children, tone = 'info' }) {
  const colors = toneMap[tone] || toneMap.info;

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 20,
        color: colors.color,
        lineHeight: 1.65,
        padding: '14px 16px',
      }}
    >
      {children}
    </div>
  );
}

export function Modal({ actions, children, contentClassName, contentStyle, inline = false, onClose, open, size = 'default', title }) {
  if (!open) {
    return null;
  }

  const isCompact = size === 'compact';

  const modalContent = (
    <div
      className={['glass-panel app-modal-content', contentClassName].filter(Boolean).join(' ')}
      onClick={(event) => event.stopPropagation()}
      style={{
        borderRadius: theme.radius.lg,
        boxSizing: 'border-box',
        display: 'inline-grid',
        gap: 16,
        gridTemplateRows: actions
          ? (isCompact ? 'auto auto auto' : 'auto minmax(0, 1fr) auto')
          : (isCompact ? 'auto auto' : 'auto minmax(0, 1fr)'),
        margin: inline ? 0 : '0 auto',
        maxHeight: inline ? 'none' : 'calc(100dvh - 40px)',
        maxWidth: inline ? '100%' : isCompact ? 760 : 1120,
        minWidth: inline ? 0 : 'min(100%, 340px)',
        overflow: inline ? 'visible' : isCompact ? 'visible' : 'hidden',
        padding: 24,
        width: inline ? '100%' : 'fit-content',
        ...contentStyle,
      }}
    >
      {title ? (
        <h3
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 26,
            letterSpacing: '-0.06em',
            lineHeight: 1,
            margin: 0,
          }}
        >
          {title}
        </h3>
      ) : null}
      <div
        style={{
          color: theme.colors.slate,
          height: inline || isCompact ? 'auto' : '100%',
          lineHeight: 1.7,
          minHeight: 0,
          overflowY: inline || isCompact ? 'visible' : 'auto',
          paddingRight: 4,
        }}
      >
        {children}
      </div>
      {actions ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'center',
            paddingTop: 4,
          }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );

  if (inline) {
    return modalContent;
  }

  return (
    <div
      className="app-modal-backdrop"
      onClick={onClose}
      style={{
        alignItems: 'center',
        background: alpha(theme.colors.ink, 0.35),
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        overflowY: 'auto',
        padding: 20,
        position: 'fixed',
        zIndex: 1000,
      }}
    >
      {modalContent}
    </div>
  );
}
