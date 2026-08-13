export const theme = {
  colors: {
    ink: '#18212e',
    slate: '#5c6978',
    muted: '#8e98a5',
    line: '#d8dfde',
    panel: '#fffdf8',
    canvas: '#f4efe6',
    teal: '#1f6f63',
    coral: '#c96a43',
    amber: '#b98528',
    sky: '#4b7f90',
    success: '#34704a',
    warning: '#a66f22',
    danger: '#a94844',
    info: '#3f6d86',
  },
  shadows: {
    soft: '0 20px 60px rgba(24, 33, 46, 0.08)',
    panel: '0 24px 80px rgba(24, 33, 46, 0.1)',
    button: '0 16px 34px rgba(24, 33, 46, 0.12)',
  },
  radius: {
    sm: 16,
    md: 24,
    lg: 32,
    pill: 999,
  },
  fonts: {
    body: 'var(--ui-font-body)',
    display: 'var(--ui-font-display)',
    mono: 'var(--ui-font-body)',
  },
  gradients: {
    user: 'radial-gradient(circle at top left, rgba(31, 111, 99, 0.18), transparent 32%), linear-gradient(180deg, #f6f1e7 0%, #f0ebe1 100%)',
    admin: 'radial-gradient(circle at top left, rgba(201, 106, 67, 0.18), transparent 32%), linear-gradient(180deg, #f6f1e7 0%, #ece6dc 100%)',
    glow: 'linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(226, 237, 233, 0.8))',
  },
};

export function alpha(color, opacity) {
  if (!color) {
    return `rgba(24, 33, 46, ${opacity})`;
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

    const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
    const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
    const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }

  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
  }

  return color;
}
