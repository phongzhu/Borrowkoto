import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import {
  bodyFontFallback,
  headerFontFallback,
  toUISettingsForm,
  useUISettings,
} from '../../context/UISettingsContext';
import { UploadIcon } from '../../ui/icons';
import { Button, FileInput, FormField, Input, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import AdminShell from './AdminShell';

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
      blue: Number.parseInt(normalizedHex.slice(4, 6), 16),
      green: Number.parseInt(normalizedHex.slice(2, 4), 16),
      red: Number.parseInt(normalizedHex.slice(0, 2), 16),
    };
  }

  if (color.startsWith('rgb')) {
    const channels = color.match(/\d+/g);

    if (!channels || channels.length < 3) {
      return null;
    }

    return {
      blue: Number.parseInt(channels[2], 10),
      green: Number.parseInt(channels[1], 10),
      red: Number.parseInt(channels[0], 10),
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

function buildPayload(form, updatedBy, logoUrl) {
  return {
    body_font_family: sanitizeText(form.body_font_family) || bodyFontFallback,
    header_font_family: sanitizeText(form.header_font_family) || headerFontFallback,
    logo_icon: sanitizeText(form.logo_icon),
    logo_url: sanitizeText(logoUrl ?? form.logo_url),
    primary_color: sanitizeText(form.primary_color),
    primary_text_color: sanitizeText(form.primary_text_color),
    secondary_color: sanitizeText(form.secondary_color),
    secondary_text_color: sanitizeText(form.secondary_text_color),
    system_description: sanitizeText(form.system_description),
    system_name: sanitizeText(form.system_name),
    system_tagline: sanitizeText(form.system_tagline),
    tertiary_color: sanitizeText(form.tertiary_color),
    tertiary_text_color: sanitizeText(form.tertiary_text_color),
    updated_by: updatedBy,
  };
}

export default function UISettings() {
  const { error, hasRecord, loading, refresh, settings } = useUISettings();
  const [activeTab, setActiveTab] = useState('name');
  const [form, setForm] = useState(toUISettingsForm(settings));
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(toUISettingsForm(settings));
  }, [settings]);

  const currentLogoUrl = sanitizeText(form.logo_url);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  const preview = useMemo(() => {
    const primaryColor = sanitizeText(form.primary_color) || theme.colors.teal;
    const secondaryColor = sanitizeText(form.secondary_color) || theme.colors.coral;
    const tertiaryColor = sanitizeText(form.tertiary_color) || theme.colors.amber;
    const primaryTextColor = sanitizeText(form.primary_text_color) || theme.colors.ink;
    const secondaryTextColor = sanitizeText(form.secondary_text_color) || theme.colors.slate;
    const tertiaryTextColor = sanitizeText(form.tertiary_text_color) || theme.colors.muted;
    const resolvedLogoUrl = logoPreviewUrl || currentLogoUrl;
    const resolvedBodyFontFamily = sanitizeText(form.body_font_family) || bodyFontFallback;
    const resolvedHeaderFontFamily = sanitizeText(form.header_font_family) || headerFontFallback;
    const resolvedSystemName = sanitizeText(form.system_name) || 'System';
    const resolvedLogoLabel = sanitizeText(form.logo_icon) || resolvedSystemName.slice(0, 2).toUpperCase();

    return {
      description: sanitizeText(form.system_description),
      bodyFontFamily: resolvedBodyFontFamily,
      headerFontFamily: resolvedHeaderFontFamily,
      logoLabel: resolvedLogoLabel,
      logoUrl: resolvedLogoUrl,
      primaryColor,
      primaryTextColor,
      secondaryColor,
      secondaryTextColor,
      systemName: resolvedSystemName,
      tagline: sanitizeText(form.system_tagline),
      tertiaryColor,
      tertiaryTextColor,
    };
  }, [currentLogoUrl, form, logoPreviewUrl]);

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function uploadLogo(recordId) {
    if (!logoFile) {
      return sanitizeText(form.logo_url);
    }

    const storagePath = `public/${recordId}/${logoFile.name}`;
    const { error: uploadError } = await supabase.storage.from('logo').upload(storagePath, logoFile, { upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from('logo').getPublicUrl(storagePath);
    return data.publicUrl;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage('');

    const trimmedName = sanitizeText(form.system_name);

    if (!trimmedName) {
      setMessage('System name is required.');
      setMessageTone('warning');
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const updatedBy = user?.id || null;
      let recordId = hasRecord ? settings.ui_settings_id : null;
      let logoUrl = sanitizeText(form.logo_url);

      if (!recordId) {
        const { data: insertedRecord, error: insertError } = await supabase
          .from('ui_settings')
          .insert([buildPayload(form, updatedBy, logoUrl)])
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        recordId = insertedRecord.ui_settings_id;
      }

      if (logoFile) {
        logoUrl = await uploadLogo(recordId);
      }

      const { error: updateError } = await supabase
        .from('ui_settings')
        .update(buildPayload(form, updatedBy, logoUrl))
        .eq('ui_settings_id', recordId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      await refresh();
      setLogoFile(null);
      setMessage(hasRecord ? 'UI settings updated successfully.' : 'UI settings created successfully.');
      setMessageTone('success');
    } catch (submitError) {
      setMessage(`Save failed: ${submitError.message}`);
      setMessageTone('danger');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminShell subtitle="" title="">
        <Panel>
          <StatusMessage tone="info">Loading interface settings.</StatusMessage>
        </Panel>
      </AdminShell>
    );
  }

  return (
    <AdminShell subtitle="" title="">
      <div className="ui-settings-page" data-tab={activeTab}>
        <div aria-label="UI settings sections" className="ui-settings-tabs" role="tablist">
          {[
            ['name', 'Name'],
            ['colors', 'Colors'],
            ['logo', 'Logo'],
            ['preview', 'Preview'],
          ].map(([value, label]) => (
            <button
              aria-selected={activeTab === value}
              className={activeTab === value ? 'active' : ''}
              key={value}
              onClick={() => setActiveTab(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

      <div className="two-column ui-settings-content" style={{ alignItems: 'start', display: 'grid', gap: 18, gridTemplateColumns: '1fr' }}>
        <Panel className="ui-settings-form-panel" style={{ borderRadius: 14, padding: 18 }}>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

            <div className="ui-settings-section ui-settings-name-section">
            <FormField label="System Name" required>
                <Input name="system_name" onChange={handleChange} required value={form.system_name || ''} />
              </FormField>
            <FormField label="System Tagline">
                <Input name="system_tagline" onChange={handleChange} value={form.system_tagline || ''} />
              </FormField>

            <FormField label="System Description">
              <Textarea name="system_description" onChange={handleChange} style={{ minHeight: 110 }} value={form.system_description || ''} />
            </FormField>
            </div>

            <div className="ui-settings-section ui-settings-colors-section">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {[['Primary Color', 'primary_color', theme.colors.teal], ['Secondary Color', 'secondary_color', theme.colors.coral], ['Tertiary Color', 'tertiary_color', theme.colors.amber], ['Primary Text', 'primary_text_color', theme.colors.ink]].map(
                ([label, name, fallback]) => {
                  const currentValue = form[name] || '';
                  const swatchValue = currentValue.startsWith('#') ? currentValue : fallback;
                  return (
                    <label key={name} style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: theme.colors.ink, fontSize: 13, fontWeight: 600 }}>{label}</span>
                      <div style={{ alignItems: 'center', display: 'grid', gap: 8, gridTemplateColumns: '34px minmax(0, 1fr)' }}>
                        <input
                          name={name}
                          onChange={handleChange}
                          style={{ background: 'transparent', border: `1px solid ${alpha(theme.colors.ink, 0.12)}`, borderRadius: 6, height: 30, padding: 0, width: 34 }}
                          type="color"
                          value={swatchValue}
                        />
                        <Input name={name} onChange={handleChange} style={{ minHeight: 40 }} value={currentValue} />
                      </div>
                    </label>
                  );
                }
              )}
            </div>

            <FormField label="Header font">
              <Input
                name="header_font_family"
                onChange={handleChange}
                value={form.header_font_family || headerFontFallback}
              />
            </FormField>
            <FormField label="Body font">
              <Input
                name="body_font_family"
                onChange={handleChange}
                value={form.body_font_family || bodyFontFallback}
              />
            </FormField>
            </div>

            <div className="ui-settings-section ui-settings-logo-section">
            <FormField label="Logo icon">
                <Input name="logo_icon" onChange={handleChange} value={form.logo_icon || ''} />
              </FormField>

            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Logo upload section</span>
              <div
                style={{
                  alignItems: 'center',
                  border: `2px dashed ${alpha(theme.colors.ink, 0.16)}`,
                  borderRadius: 12,
                  display: 'grid',
                  gap: 8,
                  justifyItems: 'center',
                  minHeight: 140,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                <UploadIcon size={22} />
                <span style={{ color: theme.colors.slate, fontSize: 13 }}>Click or drag and drop to upload your brand logo</span>
                <FileInput accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} />
              </div>
            </div>
            </div>

            {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

            <div style={{ borderTop: `1px solid ${alpha(theme.colors.ink, 0.1)}`, display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', paddingTop: 12 }}>
              <Button disabled={saving} style={{ width: '100%' }} type="submit">
                {saving ? 'Saving...' : hasRecord ? 'Save UI settings' : 'Create UI settings'}
              </Button>
              {currentLogoUrl ? (
                <Button as="a" href={currentLogoUrl} icon={<UploadIcon size={16} />} rel="noreferrer" style={{ width: '100%' }} target="_blank" variant="secondary">
                  View current logo
                </Button>
              ) : <span />}
            </div>
          </form>
        </Panel>

        <Panel className="responsive-sticky-reset ui-settings-preview-panel" style={{ borderRadius: 14, gap: 14 }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 22, letterSpacing: '-0.03em' }}>
              System Preview
            </strong>
            <span style={{ alignItems: 'center', background: alpha(preview.primaryColor, 0.12), borderRadius: 999, color: preview.primaryColor, display: 'inline-flex', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', minHeight: 22, padding: '0 10px' }}>
              LIVE
            </span>
          </div>

          <div style={{ border: `1px solid ${alpha(theme.colors.ink, 0.09)}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateRows: '48px minmax(0, 1fr)', minHeight: 520 }}>

              {/* Topbar */}
              <div style={{ alignItems: 'center', background: theme.colors.panel, borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`, display: 'flex', justifyContent: 'space-between', padding: '0 14px' }}>
                <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                  <div style={{ alignItems: 'center', background: alpha(preview.primaryColor, 0.12), borderRadius: 9, color: preview.primaryColor, display: 'inline-flex', fontSize: 11, fontWeight: 800, height: 28, justifyContent: 'center', overflow: 'hidden', width: 28 }}>
                    {preview.logoUrl ? <img alt="" src={preview.logoUrl} style={{ height: '100%', objectFit: 'cover', width: '100%' }} /> : preview.logoLabel}
                  </div>
                  <div style={{ display: 'grid', gap: 1 }}>
                    <span style={{ color: theme.colors.ink, fontFamily: preview.headerFontFamily, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', lineHeight: 1, textTransform: 'uppercase' }}>
                      {preview.systemName}
                    </span>
                    <span style={{ color: theme.colors.slate, fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Member panel
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  <span style={{ background: alpha(theme.colors.ink, 0.06), border: `1px solid ${alpha(theme.colors.ink, 0.1)}`, borderRadius: 999, display: 'inline-block', height: 24, width: 24 }} />
                  <span style={{ background: alpha(theme.colors.ink, 0.06), border: `1px solid ${alpha(theme.colors.ink, 0.1)}`, borderRadius: 999, display: 'inline-block', height: 24, width: 24 }} />
                </div>
              </div>

              {/* Body */}
              <div style={{ display: 'grid', gridTemplateColumns: '148px minmax(0, 1fr)', minWidth: 0 }}>

                {/* Sidebar */}
                <aside style={{ alignContent: 'start', background: theme.colors.panel, borderRight: `1px solid ${alpha(theme.colors.ink, 0.07)}`, display: 'grid', gap: 3, padding: '12px 8px' }}>
                  {[
                    { section: 'Browse' },
                    { label: 'Browse listings', active: true },
                    { section: 'Rentals' },
                    { label: 'Rental Items' },
                    { label: 'Manage Booking' },
                    { label: 'Report' },
                    { section: 'Communication' },
                    { label: 'Messages' },
                  ].map((item, i) =>
                    item.section ? (
                      <span key={i} style={{ color: theme.colors.muted, display: 'block', fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', margin: i === 0 ? '2px 6px 0' : '8px 6px 0', textTransform: 'uppercase' }}>
                        {item.section}
                      </span>
                    ) : (
                      <div key={i} style={{ alignItems: 'center', background: item.active ? alpha(preview.primaryColor, 0.1) : 'transparent', border: `1px solid ${item.active ? alpha(preview.primaryColor, 0.18) : 'transparent'}`, borderRadius: 7, display: 'flex', gap: 6, minHeight: 30, padding: '0 6px' }}>
                        <span style={{ background: item.active ? alpha(preview.primaryColor, 0.2) : alpha(theme.colors.ink, 0.07), borderRadius: 5, display: 'inline-block', flexShrink: 0, height: 18, width: 18 }} />
                        <span style={{ color: item.active ? preview.primaryColor : theme.colors.slate, flex: 1, fontFamily: preview.bodyFontFamily, fontSize: 10, fontWeight: item.active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </span>
                        {item.active ? <span style={{ background: preview.primaryColor, borderRadius: 999, flexShrink: 0, height: 16, width: 3 }} /> : null}
                      </div>
                    )
                  )}
                </aside>

                {/* Content */}
                <div style={{ alignContent: 'start', background: `linear-gradient(180deg, ${alpha(preview.tertiaryColor, 0.1)} 0px, rgba(255,255,255,0.98) 140px)`, display: 'grid', gap: 12, padding: 14 }}>

                  {/* Page header */}
                  <div style={{ display: 'grid', gap: 3 }}>
                    <strong style={{ color: theme.colors.ink, fontFamily: preview.headerFontFamily, fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                      Browse listings
                    </strong>
                    <span style={{ color: theme.colors.slate, fontFamily: preview.bodyFontFamily, fontSize: 10, lineHeight: 1.5 }}>
                      {preview.tagline || 'Find items to borrow in your community.'}
                    </span>
                  </div>

                  {/* Filter pills */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {['All', 'Electronics', 'Tools', 'Outdoors'].map((tab, i) => (
                      <span key={tab} style={{ background: i === 0 ? preview.primaryColor : alpha(theme.colors.ink, 0.06), borderRadius: 999, color: i === 0 ? getContrastText(preview.primaryColor) : theme.colors.slate, fontSize: 9, fontWeight: 600, padding: '3px 8px' }}>
                        {tab}
                      </span>
                    ))}
                  </div>

                  {/* Item cards */}
                  <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                    {[
                      { name: 'Speaker', price: '₱350/day', c1: preview.primaryColor, c2: preview.secondaryColor },
                      { name: 'Power Drill', price: '₱150/day', c1: preview.secondaryColor, c2: preview.tertiaryColor },
                    ].map((card) => (
                      <div key={card.name} style={{ alignContent: 'space-between', background: `linear-gradient(140deg, ${alpha(card.c1, 0.24)}, ${alpha(card.c2, 0.32)})`, border: `1px solid ${alpha(theme.colors.ink, 0.07)}`, borderRadius: 8, display: 'grid', minHeight: 80, overflow: 'hidden', padding: 8 }}>
                        <span style={{ background: alpha('#fff', 0.82), borderRadius: 999, color: theme.colors.ink, fontSize: 7, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 6px', width: 'fit-content' }}>
                          AVAILABLE
                        </span>
                        <div style={{ display: 'grid', gap: 1 }}>
                          <span style={{ color: theme.colors.ink, fontFamily: preview.headerFontFamily, fontSize: 10, fontWeight: 700 }}>{card.name}</span>
                          <span style={{ color: preview.primaryColor, fontSize: 9, fontWeight: 700 }}>{card.price}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* CTA */}
                  <div style={{ background: preview.primaryColor, borderRadius: 7, color: getContrastText(preview.primaryColor), display: 'grid', fontFamily: preview.bodyFontFamily, fontSize: 11, fontWeight: 700, minHeight: 32, placeItems: 'center' }}>
                    Request Rental
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
      </div>
    </AdminShell>
  );
}
