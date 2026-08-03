import React from 'react';

function IconBase({ children, size = 18, stroke = 'currentColor', viewBox = '0 0 24 24' }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox={viewBox}
      width={size}
    >
      {children}
    </svg>
  );
}

export function ArrowRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

export function ChevronRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}

export function MenuIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </IconBase>
  );
}

export function CloseIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </IconBase>
  );
}

export function ArrowUpRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </IconBase>
  );
}

export function EyeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function EyeOffIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 3 21 21" />
      <path d="M10.6 6.3A11.8 11.8 0 0 1 12 6c6.5 0 10 6 10 6a18.6 18.6 0 0 1-4.1 4.8" />
      <path d="M6.2 6.8A18.2 18.2 0 0 0 2 12s3.5 6 10 6a11 11 0 0 0 4-.7" />
      <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
    </IconBase>
  );
}

export function CalendarIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <rect height="16" rx="2.5" width="18" x="3" y="5" />
      <path d="M3 10h18" />
    </IconBase>
  );
}

export function CatalogIcon(props) {
  return (
    <IconBase {...props}>
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
    </IconBase>
  );
}

export function CheckIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m5 12 4 4 10-10" />
    </IconBase>
  );
}

export function MailIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <path d="m3 8 9 6 9-6" />
    </IconBase>
  );
}

export function LockIcon(props) {
  return (
    <IconBase {...props}>
      <rect height="11" rx="2.5" width="14" x="5" y="10" />
      <path d="M8 10V7.5A4 4 0 0 1 12 3.5a4 4 0 0 1 4 4V10" />
    </IconBase>
  );
}

export function KeyIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="8.5" cy="15.5" r="3.5" />
      <path d="M12 13h9" />
      <path d="M18 13v3" />
      <path d="M21 13v2" />
    </IconBase>
  );
}

export function FilterIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </IconBase>
  );
}

export function HomeIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </IconBase>
  );
}

export function MessageIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    </IconBase>
  );
}

export function PhoneIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M21 16.5v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 10.2 18a19.2 19.2 0 0 1-6-6A19.8 19.8 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8l-1.2 1.2a16 16 0 0 0 5 5l1.2-1.2a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2Z" />
    </IconBase>
  );
}

export function VideoIcon(props) {
  return (
    <IconBase {...props}>
      <rect height="12" rx="2.5" width="13" x="3" y="6" />
      <path d="m16 10 5-3v10l-5-3Z" />
    </IconBase>
  );
}

export function MoreHorizontalIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function ImageIcon(props) {
  return (
    <IconBase {...props}>
      <rect height="16" rx="2.5" width="18" x="3" y="4" />
      <circle cx="9" cy="10" r="1.2" />
      <path d="m21 15-4.5-4.5L8 19" />
    </IconBase>
  );
}

export function SmileIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0" />
    </IconBase>
  );
}

export function MicIcon(props) {
  return (
    <IconBase {...props}>
      <rect height="11" rx="3.5" width="7" x="8.5" y="3.5" />
      <path d="M6 11.5a6 6 0 0 0 12 0" />
      <path d="M12 17.5v3" />
    </IconBase>
  );
}

export function MoonIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M20 15.4A8 8 0 1 1 8.6 4 6.5 6.5 0 0 0 20 15.4Z" />
    </IconBase>
  );
}

export function LogoutIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </IconBase>
  );
}

export function PaletteIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3c-5 0-9 4-9 9a7 7 0 0 0 7 7h1.5a1.5 1.5 0 0 0 0-3H10a2 2 0 0 1 0-4h2a6 6 0 0 0 0-12Z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="9.5" cy="7.5" r="1" />
      <circle cx="14.5" cy="7.5" r="1" />
      <circle cx="16.5" cy="11" r="1" />
    </IconBase>
  );
}

export function ProfileIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </IconBase>
  );
}

export function ReportIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M7 4h7l5 5v11H7z" />
      <path d="M14 4v5h5" />
      <path d="M10 13h4" />
      <path d="M10 17h4" />
    </IconBase>
  );
}

export function SearchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </IconBase>
  );
}

export function ShieldIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3 5 6v6c0 4.7 2.9 7.9 7 9 4.1-1.1 7-4.3 7-9V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.7-3.7" />
    </IconBase>
  );
}

export function SparkIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
      <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </IconBase>
  );
}

export function StarIcon(props) {
  return (
    <IconBase {...props}>
      <path d="m12 3 2.7 5.5 6 0.9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-0.9L12 3Z" />
    </IconBase>
  );
}

export function BookmarkIcon({ filled = false, size = 18, stroke = 'currentColor' }) {
  return (
    <svg
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      height={size}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </svg>
  );
}

export function UploadIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 16V5" />
      <path d="m7 10 5-5 5 5" />
      <path d="M5 19h14" />
    </IconBase>
  );
}

export function UsersIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16.5 3.3a4 4 0 0 1 0 7.4" />
    </IconBase>
  );
}

export function BrandMark({ size = 20 }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 48 48" width={size}>
      <path d="M11 13.5C11 9.9 13.9 7 17.5 7H31c3.9 0 7 3.1 7 7v8.8c0 3.7-3 6.7-6.7 6.7H22l-8.5 8.5V13.5Z" fill="currentColor" opacity="0.16" />
      <path
        d="M15 14.5a4.5 4.5 0 0 1 4.5-4.5h10a5.5 5.5 0 0 1 5.5 5.5v6.2a4.8 4.8 0 0 1-4.8 4.8H22l-7 7V14.5Z"
        fill="currentColor"
      />
      <path d="M20 17h10" stroke="#fff" strokeLinecap="round" strokeWidth="2.2" />
      <path d="M20 22h6.5" stroke="#fff" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}
