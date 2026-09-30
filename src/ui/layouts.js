import React, { useEffect, useState } from 'react';
import { useUISettings } from '../context/UISettingsContext';
import { alpha, theme } from './theme';
import { BrandMark, ChevronLeftIcon, ChevronRightIcon, CloseIcon, MenuIcon } from './icons';

function normalizeColor(value, fallback) {
  return value?.trim() || fallback;
}

function parseColor(color) {
  if (!color) {
    return null;
  }

  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const normalizedHex =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex;

    return {
      red: Number.parseInt(normalizedHex.slice(0, 2), 16),
      green: Number.parseInt(normalizedHex.slice(2, 4), 16),
      blue: Number.parseInt(normalizedHex.slice(4, 6), 16),
    };
  }

  if (color.startsWith('rgb')) {
    const channels = color.match(/\d+/g);

    if (!channels || channels.length < 3) {
      return null;
    }

    return {
      red: Number.parseInt(channels[0], 10),
      green: Number.parseInt(channels[1], 10),
      blue: Number.parseInt(channels[2], 10),
    };
  }

  return null;
}

function getContrastText(color, light = '#ffffff', dark = theme.colors.ink) {
  const rgb = parseColor(color);

  if (!rgb) {
    return light;
  }

  const luminance = (0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue) / 255;
  return luminance > 0.62 ? dark : light;
}

function getWorkspacePalette(settings, isAdmin) {
  const primary = normalizeColor(settings.primary_color, theme.colors.teal);
  const secondary = normalizeColor(settings.secondary_color, theme.colors.coral);
  const tertiary = normalizeColor(settings.tertiary_color, theme.colors.canvas);
  const primaryText = normalizeColor(settings.primary_text_color, theme.colors.ink);
  const secondaryText = normalizeColor(settings.secondary_text_color, theme.colors.slate);
  const tertiaryText = normalizeColor(settings.tertiary_text_color, theme.colors.muted);
  const chrome = tertiary;
  const chromeText = theme.colors.ink;
  const sidebarBackground = tertiary;
  const sidebarText = theme.colors.ink;
  const sidebarMuted = theme.colors.slate;
  const sidebarSurface = alpha(primary, 0.1);
  const sidebarBorder = alpha(primary, 0.16);
  const sidebarIconBg = alpha(theme.colors.ink, 0.06);
  const sidebarLogoBackground = alpha(primary, 0.1);
  const activeAccent = primary;
  const pageBackground = tertiary;

  return {
    activeAccent,
    chrome,
    chromeText,
    pageBackground,
    panelBackground: tertiary,
    primary,
    primaryText,
    secondary,
    secondaryText,
    sidebarBackground,
    sidebarBorder,
    sidebarIconBg,
    sidebarLogoBackground,
    sidebarMuted,
    sidebarSurface,
    sidebarText,
    tertiary,
    tertiaryText,
  };
}

function useCompactViewport(breakpoint = 980) {
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handleChange = (event) => setIsCompact(event.matches);

    setIsCompact(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [breakpoint]);

  return isCompact;
}

function SidebarHeader({ brandName, collapsed, compact, logoIcon, logoUrl, palette, roleLabel }) {
  const brandFallbackText = (logoIcon || brandName.slice(0, 2) || 'BK').toUpperCase();
  const isCompact = compact;
  const headerGap = isCompact ? 10 : 'clamp(6px, 1.8vh, 18px)';
  const logoSize = isCompact ? 42 : 'clamp(38px, 5.6vh, 56px)';

  return (
    <div style={{ display: 'grid', gap: headerGap }}>
      <div style={{ alignItems: 'center', display: 'grid', gap: isCompact ? 8 : 'clamp(8px, 1.2vh, 12px)', gridTemplateColumns: collapsed ? '1fr' : `${logoSize} minmax(0, 1fr)` }}>
        <div
          style={{
            alignItems: 'center',
            background: palette.sidebarLogoBackground,
            borderRadius: isCompact ? 14 : 18,
            color: palette.activeAccent,
            display: 'inline-flex',
            height: logoSize,
            justifyContent: 'center',
            justifySelf: 'center',
            overflow: 'hidden',
            width: logoSize,
          }}
        >
          {logoUrl ? (
            <img alt={brandName} src={logoUrl} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
          ) : logoIcon ? (
            <span style={{ fontFamily: theme.fonts.display, fontSize: isCompact ? 11 : 14, fontWeight: 800, letterSpacing: '0.08em' }}>{brandFallbackText}</span>
          ) : (
            <BrandMark size={isCompact ? 18 : 24} />
          )}
        </div>
        {!collapsed ? (
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <strong
              style={{
                color: palette.sidebarText,
                fontFamily: theme.fonts.display,
                fontSize: isCompact ? 18 : 'clamp(17px, 2.4vh, 24px)',
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {brandName}
            </strong>
            <span
              style={{
                color: palette.sidebarMuted,
                fontSize: isCompact ? 10 : 'clamp(9px, 1.2vh, 12px)',
                fontWeight: 600,
                letterSpacing: '0.13em',
                textTransform: 'uppercase',
              }}
            >
              {roleLabel}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SidebarNavItem({ active, compact, collapsed, icon, item, onNavigate, palette }) {
  const itemText = active ? palette.sidebarText : palette.sidebarMuted;
  const isDense = compact || collapsed;
  const rowHeight = isDense ? 34 : 'clamp(34px, 5.8vh, 58px)';
  const iconSize = isDense ? 28 : 'clamp(28px, 4.4vh, 44px)';

  return (
    <button
      onClick={() => onNavigate(item.path)}
      style={{
        alignItems: 'center',
        background: active ? palette.sidebarSurface : 'transparent',
        border: `1px solid ${active ? palette.sidebarBorder : 'transparent'}`,
        borderRadius: isDense ? 14 : 24,
        color: itemText,
        cursor: 'pointer',
        display: 'grid',
        gap: isDense ? 0 : 14,
        gridTemplateColumns: isDense ? '1fr' : '44px minmax(0, 1fr) 6px',
        justifyItems: isDense ? 'center' : 'stretch',
        minHeight: rowHeight,
        padding: isDense ? '0 4px' : '0 14px',
        position: 'relative',
        textAlign: isDense ? 'center' : 'left',
        transition: 'background 160ms ease, border-color 160ms ease',
      }}
    >
      <span
        style={{
          alignItems: 'center',
          background: active ? alpha(palette.activeAccent, 0.16) : palette.sidebarIconBg,
          borderRadius: isDense ? 10 : 16,
          color: active ? palette.activeAccent : itemText,
          display: 'inline-flex',
          height: iconSize,
          justifyContent: 'center',
          width: iconSize,
        }}
      >
        {React.cloneElement(icon, { size: isDense ? 14 : 18 })}
      </span>

      {!isDense ? (
        <span
          style={{
            color: itemText,
            fontFamily: theme.fonts.display,
            fontSize: isDense ? 12 : 15,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.label}
        </span>
      ) : null}

      {active && !isDense ? (
        <span
          style={{
            alignSelf: 'center',
            background: palette.activeAccent,
            borderRadius: 999,
            height: 'clamp(12px, 1.8vh, 18px)',
            width: 4,
          }}
        />
      ) : null}

      {active && isDense ? (
        <span
          style={{
            background: palette.activeAccent,
            borderRadius: 999,
            bottom: 6,
            height: 4,
            position: 'absolute',
            width: 12,
          }}
        />
      ) : null}
    </button>
  );
}

export function SectionGrid({ children, className, columns = 3, style }) {
  return (
    <div
      className={['section-grid', className].filter(Boolean).join(' ')}
      style={{
        alignItems: 'start',
        display: 'grid',
        gap: 20,
        gridAutoRows: 'max-content',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function AuthLayout({ accent, badge, children, subtitle, title }) {
  const { settings } = useUISettings();
  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const brandTagline = settings.system_tagline?.trim();
  const systemDescription = settings.system_description?.trim();
  const logoUrl = settings.logo_url?.trim();
  const primary = normalizeColor(settings.primary_color, theme.colors.teal);
  const primaryText = normalizeColor(settings.primary_text_color, theme.colors.ink);
  const accentColor = normalizeColor(accent, primary);
  const heroBase = getContrastText(primaryText) === '#ffffff' ? primaryText : theme.colors.ink;
  const heroCopy = systemDescription || brandTagline || subtitle;

  return (
    <div
      style={{
        background: '#ffffff',
        minHeight: '100vh',
        overflowX: 'hidden',
        width: '100%',
      }}
    >
      <div
        className="auth-shell"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          margin: 0,
          minHeight: '100vh',
          width: '100vw',
        }}
      >
        <section
          className="auth-visual"
          style={{
            alignItems: 'center',
            background: `linear-gradient(160deg, ${alpha(heroBase, 0.98)} 0%, ${alpha(primary, 0.78)} 56%, ${alpha(primary, 0.58)} 100%)`,
            color: getContrastText(heroBase),
            display: 'flex',
            overflow: 'hidden',
            padding: 'clamp(32px, 5vw, 64px)',
            position: 'relative',
          }}
        >
          <div
            style={{
              background: alpha('#ffffff', 0.08),
              borderRadius: '50%',
              height: 260,
              left: -90,
              position: 'absolute',
              top: -70,
              width: 260,
            }}
          />
          <div
            style={{
              background: `linear-gradient(180deg, ${alpha('#ffffff', 0.14)}, transparent)`,
              bottom: 0,
              left: 0,
              opacity: 0.42,
              position: 'absolute',
              right: 0,
              top: '54%',
            }}
          />
          <div
            style={{
              display: 'grid',
              gap: 26,
              margin: 'auto 0',
              maxWidth: 520,
              position: 'relative',
              width: '100%',
              zIndex: 1,
            }}
          >
            <div
              style={{
                alignItems: 'center',
                background: alpha('#ffffff', 0.06),
                border: `1px solid ${alpha('#ffffff', 0.14)}`,
                borderRadius: 24,
                display: 'inline-flex',
                height: 88,
                justifyContent: 'center',
                overflow: 'hidden',
                width: 88,
              }}
            >
              {logoUrl ? <img alt={brandName} src={logoUrl} style={{ height: '100%', objectFit: 'cover', width: '100%' }} /> : <BrandMark size={34} />}
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {brandTagline ? (
                <span
                  style={{
                    color: alpha('#ffffff', 0.76),
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {brandTagline}
                </span>
              ) : null}

              <h1
                style={{
                  color: '#ffffff',
                  fontFamily: theme.fonts.display,
                  fontSize: 'clamp(2.7rem, 4.4vw, 4.25rem)',
                  letterSpacing: '-0.045em',
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                {`Welcome to ${brandName}`}
              </h1>

              {heroCopy ? (
                <p
                  style={{
                    color: alpha('#ffffff', 0.78),
                    fontSize: 17,
                    lineHeight: 1.75,
                    margin: 0,
                    maxWidth: 500,
                  }}
                >
                  {heroCopy}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section
          className="auth-form-stage"
          style={{
            background: '#ffffff',
            display: 'flex',
            minHeight: '100vh',
            padding: 'clamp(32px, 6vw, 72px) clamp(24px, 7vw, 110px)',
          }}
        >
          <div style={{ display: 'grid', gap: 26, margin: 'auto', maxWidth: 520, width: '100%' }}>
            <div style={{ display: 'grid', gap: 12 }}>
              {badge ? (
                <span
                  style={{
                    color: accentColor,
                    fontFamily: theme.fonts.display,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}
                >
                  {badge}
                </span>
              ) : null}
              <h2
                style={{
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.display,
                  fontSize: 'clamp(2.15rem, 4vw, 3.2rem)',
                  letterSpacing: '-0.045em',
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                {title}
              </h2>
              {subtitle ? <p style={{ color: theme.colors.slate, lineHeight: 1.75, margin: 0, maxWidth: 460 }}>{subtitle}</p> : null}
            </div>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}

export function WorkspaceLayout({
  actions,
  activePath,
  children,
  collapsed,
  kind,
  navItems,
  onNavigate,
  setCollapsed,
  subtitle,
  topbarExtrasLeft,
  title,
}) {
  const { settings } = useUISettings();
  const isAdmin = kind === 'admin';
  const isCompactViewport = useCompactViewport();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const effectiveCollapsed = isCompactViewport ? true : collapsed;
  const sidebarWidth = effectiveCollapsed ? 96 : 296;
  const palette = getWorkspacePalette(settings, isAdmin);
  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const logoIcon = settings.logo_icon?.trim();
  const logoUrl = settings.logo_url?.trim();
  const roleLabel = isAdmin ? 'Admin panel' : 'User dashboard';
  const mobileTopbarHeight = 72;
  const mobileTopbarZIndex = 2100;
  const mobileDrawerZIndex = 2050;
  const mobileBackdropZIndex = 2000;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activePath, isCompactViewport]);

  useEffect(() => {
    if (!isCompactViewport || !mobileMenuOpen || typeof document === 'undefined') {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isCompactViewport, mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen || typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  function handleNavigate(path) {
    if (isCompactViewport) {
      setMobileMenuOpen(false);
    }

    onNavigate(path);
  }

  const sidebarContent = (
    <aside
      className="workspace-sidebar-panel"
      style={{
        background: palette.sidebarBackground,
        borderRight: `1px solid ${palette.sidebarBorder}`,
        color: palette.sidebarText,
        display: 'flex',
        flexDirection: 'column',
        gap: isCompactViewport ? 6 : 'clamp(6px, 2.2vh, 22px)',
        height: '100%',
        overflowX: 'hidden',
        overflowY: 'hidden',
        padding: effectiveCollapsed
          ? (isCompactViewport ? '8px 6px' : 'clamp(8px, 2vh, 20px) 12px')
          : 'clamp(8px, 2.6vh, 26px) 16px clamp(8px, 1.8vh, 18px)',
      }}
    >
      {isCompactViewport ? (
        <div
          style={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: 6,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <SidebarHeader
              brandName={brandName}
              collapsed={true}
              compact={isCompactViewport}
              logoIcon={logoIcon}
              logoUrl={logoUrl}
              palette={palette}
              roleLabel={roleLabel}
            />
          </div>
        </div>
      ) : (
        <SidebarHeader
          brandName={brandName}
          collapsed={effectiveCollapsed}
          compact={isCompactViewport}
          logoIcon={logoIcon}
          logoUrl={logoUrl}
          palette={palette}
          roleLabel={roleLabel}
        />
      )}

      <nav style={{ display: 'grid', gap: isCompactViewport ? 2 : 'clamp(2px, 1vh, 10px)', marginTop: isCompactViewport ? 0 : 'clamp(0px, 0.6vh, 6px)' }}>
        {navItems.map((item, index) =>
          item.type === 'section' ? (
            !effectiveCollapsed && !isCompactViewport ? (
              <span
                key={`${item.label}-${index}`}
                style={{
                  color: palette.sidebarMuted,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  margin: index === 0 ? '0 12px' : 'clamp(1px, 0.4vh, 4px) 12px 0',
                  textTransform: 'uppercase',
                }}
              >
                {item.label}
              </span>
            ) : (
              <span
                aria-hidden="true"
                key={`${item.label}-${index}`}
                style={{
                  background: palette.sidebarBorder,
                  height: 1,
                  margin: index === 0 ? '0 12px 0' : '2px 12px 0',
                }}
              />
            )
          ) : (
            <SidebarNavItem
              active={activePath === item.path}
              compact={isCompactViewport}
              collapsed={effectiveCollapsed}
              icon={item.icon}
              item={item}
              key={item.path}
              onNavigate={handleNavigate}
              palette={palette}
            />
          )
        )}
      </nav>
    </aside>
  );

  return (
    <div
      className="workspace-shell"
      style={{
        background: palette.pageBackground,
        display: 'grid',
        gridTemplateColumns: isCompactViewport ? 'minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)`,
        minHeight: '100vh',
        width: '100%',
      }}
    >
      {!isCompactViewport ? (
        <div
          className="workspace-sidebar-wrap"
          style={{
            alignSelf: 'start',
            height: '100vh',
            maxWidth: sidebarWidth,
            minWidth: sidebarWidth,
            overflow: 'visible',
            position: 'sticky',
            top: 0,
            width: sidebarWidth,
          }}
        >
          {sidebarContent}

          <button
            aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((current) => !current)}
            style={{
              alignItems: 'center',
              background: alpha(palette.activeAccent, palette.sidebarText === '#ffffff' ? 0.78 : 0.84),
              border: `1px solid ${alpha(palette.sidebarBackground, 0.12)}`,
              borderRadius: '50%',
              boxShadow: `0 18px 30px ${alpha(palette.sidebarBackground, 0.22)}`,
              color: getContrastText(palette.activeAccent),
              cursor: 'pointer',
              display: 'inline-flex',
              height: 46,
              justifyContent: 'center',
              position: 'absolute',
              right: -23,
              top: 34,
              width: 46,
              zIndex: 3,
            }}
          >
            {effectiveCollapsed ? <ChevronRightIcon size={18} /> : <ChevronLeftIcon size={18} />}
          </button>
        </div>
      ) : (
        <>
          {mobileMenuOpen ? (
            <button
              aria-label="Close navigation menu"
              className="workspace-sidebar-backdrop"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                background: alpha(theme.colors.ink, 0.42),
                border: 0,
                bottom: 0,
                left: 0,
                padding: 0,
                position: 'fixed',
                right: 0,
                top: mobileTopbarHeight,
                zIndex: mobileBackdropZIndex,
              }}
            />
          ) : null}

          <div
            id="workspace-mobile-navigation"
            className="workspace-sidebar-drawer"
            style={{
              bottom: 0,
              left: 0,
              maxWidth: 'min(90vw, 340px)',
              position: 'fixed',
              top: mobileTopbarHeight,
              transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-104%)',
              transition: 'transform 220ms ease',
              width: '100%',
              zIndex: mobileDrawerZIndex,
            }}
          >
            {sidebarContent}
          </div>
        </>
      )}

      <main
        className="workspace-main"
        style={{
          background: palette.pageBackground,
          display: 'grid',
          gridTemplateRows: '72px auto',
          minHeight: '100vh',
          minWidth: 0,
        }}
      >
        <div
          className="workspace-topbar"
          style={{
            alignItems: 'center',
            background: palette.chrome,
            borderBottom: `1px solid ${alpha(palette.chromeText, 0.08)}`,
            color: palette.chromeText,
            display: 'flex',
            justifyContent: 'space-between',
            position: isCompactViewport ? 'sticky' : 'static',
            top: isCompactViewport ? 0 : 'auto',
            zIndex: isCompactViewport ? mobileTopbarZIndex : 'auto',
            padding: isCompactViewport ? '0 18px' : '0 28px',
          }}
        >
          <div style={{ alignItems: 'center', display: 'flex', gap: 14, minWidth: 0 }}>
            <button
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-controls="workspace-mobile-navigation"
              onClick={() => setMobileMenuOpen((current) => !current)}
              style={{
                alignItems: 'center',
                background: alpha(palette.chromeText, 0.06),
                border: `1px solid ${alpha(palette.chromeText, 0.12)}`,
                borderRadius: '50%',
                color: palette.chromeText,
                cursor: 'pointer',
                display: isCompactViewport ? 'inline-flex' : 'none',
                flexShrink: 0,
                height: 44,
                justifyContent: 'center',
                width: 44,
              }}
            >
              {mobileMenuOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
            </button>

            {isCompactViewport && topbarExtrasLeft ? (
              <div style={{ alignItems: 'center', display: 'inline-flex', flexShrink: 0 }}>{topbarExtrasLeft}</div>
            ) : null}

            {title || subtitle ? (
              <div className="workspace-mobile-title" style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <strong
                  style={{
                    color: palette.chromeText,
                    fontFamily: theme.fonts.display,
                    fontSize: isCompactViewport ? 14 : 19,
                    letterSpacing: isCompactViewport ? '0.08em' : '-0.02em',
                    lineHeight: 1.1,
                    textTransform: isCompactViewport ? 'uppercase' : 'none',
                  }}
                >
                  {title}
                </strong>
                {subtitle ? (
                  <span style={{ color: alpha(palette.chromeText, 0.78), fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {subtitle}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>{actions}</div>
        </div>

        <div
          className="workspace-content"
          style={{
            alignContent: 'start',
            display: 'grid',
            gap: 24,
            padding: isCompactViewport ? '20px 16px 24px' : '28px 28px 36px',
          }}
        >
          <div style={{ alignContent: 'start', alignItems: 'start', display: 'grid', gap: 20 }}>{children}</div>
        </div>
      </main>
    </div>
  );
}
