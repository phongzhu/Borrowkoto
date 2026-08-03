import { alpha, theme } from './theme';

/**
 * Component to display rental date information in a consistent format
 */
export function RentalDateDisplay({ checkIn, checkOut, rentalDays }) {
  if (!checkIn && !checkOut) {
    return null;
  }

  const formatDate = (date) => {
    if (!date) return 'Not selected';
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      style={{
        background: alpha(theme.colors.panel, 0.92),
        border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
        borderRadius: 8,
        display: 'grid',
        gap: 12,
        padding: 12,
      }}
    >
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Check-in
          </span>
          <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>
            {formatDate(checkIn)}
          </span>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Check-out
          </span>
          <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>
            {formatDate(checkOut)}
          </span>
        </div>
      </div>
      {rentalDays > 0 && (
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: `1px solid ${alpha(theme.colors.ink, 0.1)}` }}>
          <span style={{ color: theme.colors.slate, fontSize: 12 }}>Total duration</span>
          <strong style={{ color: theme.colors.ink, fontSize: 14 }}>{rentalDays} day(s)</strong>
        </div>
      )}
    </div>
  );
}
