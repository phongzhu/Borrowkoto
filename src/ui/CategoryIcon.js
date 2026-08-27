import React from 'react';

export const CATEGORY_ICON_OPTIONS = [
  { key: 'appliance', label: 'Appliance' },
  { key: 'baby', label: 'Baby & kids' },
  { key: 'camera', label: 'Camera' },
  { key: 'electronics', label: 'Electronics' },
  { key: 'fashion', label: 'Fashion' },
  { key: 'game', label: 'Gaming' },
  { key: 'health', label: 'Health' },
  { key: 'home', label: 'Home' },
  { key: 'laptop', label: 'Laptop' },
  { key: 'music', label: 'Music' },
  { key: 'office', label: 'Office' },
  { key: 'sports', label: 'Sports' },
  { key: 'travel', label: 'Travel' },
  { key: 'tools', label: 'Tools' },
  { key: 'box', label: 'General' },
];

const paths = {
  appliance: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M9 17h6M9 11h6v3H9z"/></>,
  baby: <><circle cx="12" cy="8" r="4"/><path d="M7 21v-3a5 5 0 0 1 10 0v3M9 8h.01M15 8h.01M10 10.5c1.2.8 2.8.8 4 0"/></>,
  camera: <><path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9H3V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/></>,
  electronics: <><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M9 20h6M12 16v4M8 9h8M8 12h5"/></>,
  fashion: <><path d="m9 4 3 2 3-2 5 4-3 4-2-1v10H9V11l-2 1-3-4 5-4Z"/></>,
  game: <><path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1 2.8a2 2 0 0 1-3.2.8L14 16h-4l-2.5 2.3a2 2 0 0 1-3.2-.8l-1-2.8A5 5 0 0 1 8 8Z"/><path d="M7 11v4M5 13h4M16 12h.01M18 14h.01"/></>,
  health: <><path d="M12 21S4 16.5 4 10a4 4 0 0 1 7-2.6A4 4 0 0 1 18 10c0 6.5-6 11-6 11Z"/><path d="M8 13h2l1-3 2 6 1-3h2"/></>,
  home: <><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/></>,
  laptop: <><rect x="5" y="4" width="14" height="11" rx="1.5"/><path d="M3 19h18l-2-4H5l-2 4Z"/></>,
  music: <><path d="M9 18V5l10-2v13M9 8l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  office: <><path d="M7 3h10v18H7zM4 7h3v14H4zM17 7h3v14h-3zM10 7h4M10 11h4M10 15h4"/></>,
  sports: <><circle cx="12" cy="12" r="9"/><path d="m8 4 3 4-2 4-5 1M16 4l-3 4 2 4 5 1M9 12l3 3 3-3M12 15v6"/></>,
  travel: <><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 11v5M15 11v5M8 20v1M16 20v1"/></>,
  tools: <><path d="M14 6a4 4 0 0 0-5-4l2.5 2.5-3 3L6 5a4 4 0 0 0 4 5L19 19a2 2 0 0 0 3-3l-8-8Z"/></>,
  box: <><path d="m4 7 8-4 8 4-8 4-8-4ZM4 7v10l8 4 8-4V7M12 11v10"/></>,
};

export default function CategoryIcon({ iconKey = 'box', iconUrl = '', size = 24 }) {
  if (iconUrl) return <img alt="" src={iconUrl} style={{ height: size, objectFit: 'contain', width: size }} />;
  return <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width={size}>{paths[iconKey] || paths.box}</svg>;
}
