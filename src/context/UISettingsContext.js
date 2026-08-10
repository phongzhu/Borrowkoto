import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../api/supabaseClient';
import { theme } from '../ui/theme';

export const headerFontFallback = '"Gilroy", "Montserrat", "Avenir Next", Arial, sans-serif';
export const bodyFontFallback = '"Dustin Sans", "Avenir Next", "Segoe UI", Arial, sans-serif';

export const defaultUISettings = {
  body_font_family: bodyFontFallback,
  header_font_family: headerFontFallback,
  logo_icon: '',
  logo_url: '',
  primary_color: '',
  primary_text_color: '',
  secondary_color: '',
  secondary_text_color: '',
  system_description: '',
  system_name: '',
  system_tagline: '',
  tertiary_color: '',
  tertiary_text_color: '',
  ui_settings_id: null,
  updated_at: null,
  updated_by: null,
};

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeUISettings(record) {
  return {
    ...defaultUISettings,
    ...(record || {}),
    body_font_family: normalizeText(record?.body_font_family) || bodyFontFallback,
    header_font_family: normalizeText(record?.header_font_family) || headerFontFallback,
    logo_icon: normalizeText(record?.logo_icon),
    logo_url: normalizeText(record?.logo_url),
    primary_color: normalizeText(record?.primary_color),
    primary_text_color: normalizeText(record?.primary_text_color),
    secondary_color: normalizeText(record?.secondary_color),
    secondary_text_color: normalizeText(record?.secondary_text_color),
    system_description: normalizeText(record?.system_description),
    system_name: normalizeText(record?.system_name),
    system_tagline: normalizeText(record?.system_tagline),
    tertiary_color: normalizeText(record?.tertiary_color),
    tertiary_text_color: normalizeText(record?.tertiary_text_color),
  };
}

function applyDocumentStyles(settings) {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const resolvedBodyFont = settings.body_font_family || bodyFontFallback;
  const resolvedHeaderFont = settings.header_font_family || headerFontFallback;
  const resolvedBackground = settings.tertiary_color || theme.colors.canvas;

  // Font variables
  root.style.setProperty('--ui-font-body', resolvedBodyFont);
  root.style.setProperty('--ui-font-display', resolvedHeaderFont);

  // Primary, secondary, and tertiary colors
  root.style.setProperty('--ui-primary-color', settings.primary_color || theme.colors.teal);
  root.style.setProperty('--ui-secondary-color', settings.secondary_color || theme.colors.coral);
  root.style.setProperty('--ui-tertiary-color', resolvedBackground);

  // Tertiary color is the system background color.
  root.style.setProperty('--ui-text-color', theme.colors.ink);
  root.style.setProperty('--ui-text-secondary', theme.colors.slate);
  root.style.setProperty('--ui-text-muted', theme.colors.muted);
  root.style.setProperty('--ui-background-color', resolvedBackground);
  root.style.setProperty('--ui-panel-color', resolvedBackground);
  root.style.setProperty('--ui-border-color', theme.colors.line);
}

const UISettingsContext = createContext({
  error: '',
  hasRecord: false,
  loading: true,
  refresh: async () => {},
  settings: defaultUISettings,
});

export function UISettingsProvider({ children }) {
  const [settings, setSettings] = useState(defaultUISettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasRecord, setHasRecord] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase
      .from('ui_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (queryError) {
      setSettings(defaultUISettings);
      setHasRecord(false);
      setError(queryError.message);
      setLoading(false);
      return;
    }

    startTransition(() => {
      setSettings(normalizeUISettings(data));
      setHasRecord(Boolean(data));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    applyDocumentStyles(settings);
  }, [settings]);

  const value = useMemo(
    () => ({
      error,
      hasRecord,
      loading,
      refresh,
      settings,
    }),
    [error, hasRecord, loading, refresh, settings]
  );

  return <UISettingsContext.Provider value={value}>{children}</UISettingsContext.Provider>;
}

export function useUISettings() {
  return useContext(UISettingsContext);
}

export function toUISettingsForm(record) {
  return normalizeUISettings(record);
}
