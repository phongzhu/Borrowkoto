import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { Badge, Button, FormField, Input, Modal, StatusMessage, Textarea } from '../../ui/primitives';
import AdminShell from './AdminShell';
import './VoucherRewards.css';

const emptyVoucher = { description: '', discount_type: 'fixed', discount_value: '', is_active: true, minimum_rental_amount: 0, name: '', points_cost: '', validity_days: 30 };
const money = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });

export default function VoucherRewards() {
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [editor, setEditor] = useState(null);
  const [deleteVoucher, setDeleteVoucher] = useState(null);
  const [rewardSettings, setRewardSettings] = useState({ id: true, is_active: true, points_per_completed_booking: 100 });
  const [settingsEditor, setSettingsEditor] = useState(null);
  const [saving, setSaving] = useState(false);

  const notify = (text, tone = 'info') => { setMessage(text); setMessageTone(tone); };
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, settingsResult] = await Promise.all([
      supabase.from('reward_voucher_catalog').select('*').order('points_cost'),
      supabase.from('reward_program_settings').select('id, points_per_completed_booking, is_active').eq('id', true).maybeSingle(),
    ]);
    setVouchers(data || []);
    if (error) { setMessage(error.message); setMessageTone('danger'); }
    if (settingsResult.data) setRewardSettings(settingsResult.data);
    if (settingsResult.error) { setMessage(settingsResult.error.message); setMessageTone('danger'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateField(field, value) {
    setEditor((current) => ({ ...current, values: { ...current.values, [field]: value } }));
  }

  async function saveVoucher(event) {
    event.preventDefault();
    const values = editor.values;
    const pointsCost = Number(values.points_cost);
    const discountValue = Number(values.discount_value);
    const minimumRental = Number(values.minimum_rental_amount);
    const validityDays = Number(values.validity_days);
    if (!values.name.trim() || !Number.isInteger(pointsCost) || pointsCost < 1 || !Number.isFinite(discountValue) || discountValue <= 0 || !Number.isFinite(minimumRental) || minimumRental < 0 || !Number.isInteger(validityDays) || validityDays < 1) {
      return notify('Complete all required fields using valid positive values.', 'danger');
    }
    if (values.discount_type === 'percentage' && discountValue > 100) return notify('Percentage discounts cannot exceed 100%.', 'danger');

    setSaving(true);
    const payload = {
      description: values.description.trim() || null,
      discount_type: values.discount_type,
      discount_value: discountValue,
      is_active: Boolean(values.is_active),
      minimum_rental_amount: minimumRental,
      name: values.name.trim(),
      points_cost: pointsCost,
      updated_at: new Date().toISOString(),
      validity_days: validityDays,
    };
    const result = editor.mode === 'add'
      ? await supabase.from('reward_voucher_catalog').insert(payload).select().single()
      : await supabase.from('reward_voucher_catalog').update(payload).eq('id', values.id).select().single();
    setSaving(false);
    if (result.error) return notify(result.error.message, 'danger');
    const action = editor.mode === 'add' ? 'added' : 'updated';
    setEditor(null);
    notify(`Voucher reward ${action}.`, 'success');
    load();
  }

  async function removeVoucher() {
    setSaving(true);
    const { error } = await supabase.from('reward_voucher_catalog').delete().eq('id', deleteVoucher.id);
    setSaving(false);
    setDeleteVoucher(null);
    if (error) return notify(error.code === '23503' ? 'This voucher has already been redeemed and cannot be deleted. Edit it and mark it inactive instead.' : error.message, 'danger');
    notify('Voucher reward deleted.', 'success');
    load();
  }

  async function saveRewardSettings(event) {
    event.preventDefault();
    const points = Number(settingsEditor.points_per_completed_booking);
    if (!Number.isInteger(points) || points < 1) return notify('Points per completed rental must be a positive whole number.', 'danger');
    setSaving(true);
    const { data, error } = await supabase.from('reward_program_settings').upsert({ id: true, is_active: Boolean(settingsEditor.is_active), points_per_completed_booking: points, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select('id, points_per_completed_booking, is_active').single();
    setSaving(false);
    if (error) return notify(error.message, 'danger');
    setRewardSettings(data);
    setSettingsEditor(null);
    notify('Reward points settings updated.', 'success');
  }

  function discountLabel(voucher) {
    return voucher.discount_type === 'percentage' ? `${Number(voucher.discount_value)}% off` : `${money.format(voucher.discount_value)} off`;
  }

  return <AdminShell subtitle="" title="">
    <main className="voucher-admin-page">
      {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
      <section className="voucher-admin-card">
        <div className="voucher-section-heading"><div><h2>Voucher catalog</h2><p>{vouchers.length} reward{vouchers.length === 1 ? '' : 's'} configured · {rewardSettings.points_per_completed_booking} points per completed rental</p></div><div className="voucher-heading-actions"><Button onClick={() => setEditor({ mode: 'add', values: { ...emptyVoucher } })}>+ Add voucher</Button><button aria-label="Configure reward points" className="voucher-settings-button" onClick={() => setSettingsEditor({ ...rewardSettings })} title="Reward points settings" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09a1.7 1.7 0 0 0-1.1-1.57 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.09A1.7 1.7 0 0 0 4 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.4 4.1a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.8 2.4V2.3h4v.09A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg></button></div></div>
        <div className="voucher-table-wrap"><table className="voucher-table">
          <thead><tr><th>Voucher</th><th>Points</th><th>Discount</th><th>Minimum rental</th><th>Validity</th><th>Status</th><th className="voucher-actions-column">Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td className="voucher-empty" colSpan="7">Loading vouchers…</td></tr> : null}
            {!loading && !vouchers.length ? <tr><td className="voucher-empty" colSpan="7">No voucher rewards yet. Add the first voucher to get started.</td></tr> : null}
            {!loading && vouchers.map((voucher) => <tr key={voucher.id}><td><strong>{voucher.name}</strong><span>{voucher.description || 'No description'}</span></td><td className="voucher-points">{voucher.points_cost} pts</td><td>{discountLabel(voucher)}</td><td>{money.format(voucher.minimum_rental_amount)}</td><td>{voucher.validity_days} days</td><td><Badge tone={voucher.is_active ? 'success' : 'neutral'}>{voucher.is_active ? 'Active' : 'Inactive'}</Badge></td><td><div className="voucher-row-actions"><Button onClick={() => setEditor({ mode: 'edit', values: { ...voucher } })} variant="secondary">Edit</Button><Button onClick={() => setDeleteVoucher(voucher)} variant="ghost">Delete</Button></div></td></tr>)}
          </tbody>
        </table></div>
      </section>

      <Modal actions={<><Button onClick={() => setEditor(null)} variant="ghost">Cancel</Button><Button disabled={saving} onClick={saveVoucher}>{saving ? 'Saving…' : editor?.mode === 'add' ? 'Add voucher' : 'Save changes'}</Button></>} onClose={() => setEditor(null)} open={Boolean(editor)} size="compact" title={editor?.mode === 'add' ? 'Add voucher reward' : 'Edit voucher reward'}>
        {editor ? <form className="voucher-form" onSubmit={saveVoucher}><FormField label="Voucher name"><Input autoFocus onChange={(e) => updateField('name', e.target.value)} required value={editor.values.name} /></FormField><FormField label="Description"><Textarea onChange={(e) => updateField('description', e.target.value)} value={editor.values.description || ''} /></FormField><div className="voucher-form-row"><FormField label="Points required"><Input min="1" onChange={(e) => updateField('points_cost', e.target.value)} required type="number" value={editor.values.points_cost} /></FormField><FormField label="Discount type"><select className="voucher-select" onChange={(e) => updateField('discount_type', e.target.value)} value={editor.values.discount_type}><option value="fixed">Fixed amount (PHP)</option><option value="percentage">Percentage</option></select></FormField></div><div className="voucher-form-row"><FormField label={editor.values.discount_type === 'percentage' ? 'Discount percentage' : 'Discount amount (PHP)'}><Input max={editor.values.discount_type === 'percentage' ? 100 : undefined} min="0.01" onChange={(e) => updateField('discount_value', e.target.value)} required step="0.01" type="number" value={editor.values.discount_value} /></FormField><FormField label="Minimum rental (PHP)"><Input min="0" onChange={(e) => updateField('minimum_rental_amount', e.target.value)} required step="0.01" type="number" value={editor.values.minimum_rental_amount} /></FormField></div><FormField hint="Number of days the voucher remains usable after a borrower redeems it." label="Valid for (days)"><Input min="1" onChange={(e) => updateField('validity_days', e.target.value)} required type="number" value={editor.values.validity_days} /></FormField><label className="voucher-active-toggle"><input checked={editor.values.is_active} onChange={(e) => updateField('is_active', e.target.checked)} type="checkbox" /><span><strong>Available to borrowers</strong><small>Inactive vouchers remain in history but cannot be redeemed.</small></span></label><button className="voucher-hidden-submit" type="submit">Submit</button></form> : null}
      </Modal>

      <Modal actions={<><Button onClick={() => setSettingsEditor(null)} variant="ghost">Cancel</Button><Button disabled={saving} onClick={saveRewardSettings}>{saving ? 'Saving…' : 'Save settings'}</Button></>} contentClassName="reward-settings-modal" onClose={() => setSettingsEditor(null)} open={Boolean(settingsEditor)} size="compact">
        {settingsEditor ? <form className="reward-settings-form" onSubmit={saveRewardSettings}><div className="reward-settings-modal-head"><span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09a1.7 1.7 0 0 0-1.1-1.57 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.09A1.7 1.7 0 0 0 4 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.4 4.1a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.8 2.4V2.3h4v.09A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg></span><div><h2>Reward points settings</h2><p>Configure how borrowers earn points.</p></div></div><div className="reward-settings-field"><FormField hint="Credited once when a rental booking changes to completed." label="Points per completed rental"><Input autoFocus min="1" onChange={(event) => setSettingsEditor((current) => ({ ...current, points_per_completed_booking: event.target.value }))} required step="1" type="number" value={settingsEditor.points_per_completed_booking} /></FormField><span>PTS</span></div><label className="reward-settings-toggle"><span><strong>Automatic rewards</strong><small>Award points when rentals are completed.</small></span><input checked={settingsEditor.is_active} onChange={(event) => setSettingsEditor((current) => ({ ...current, is_active: event.target.checked }))} type="checkbox"/><i aria-hidden="true"/></label><button className="voucher-hidden-submit" type="submit">Submit</button></form> : null}
      </Modal>

      <Modal actions={<><Button onClick={() => setDeleteVoucher(null)} variant="ghost">Cancel</Button><Button disabled={saving} onClick={removeVoucher} variant="danger">{saving ? 'Deleting…' : 'Delete voucher'}</Button></>} onClose={() => setDeleteVoucher(null)} open={Boolean(deleteVoucher)} size="compact" title="Delete voucher reward?">
        <p className="voucher-delete-copy">Delete <strong>{deleteVoucher?.name}</strong>? Redeemed vouchers are preserved for borrower history, so a voucher already in use must be marked inactive instead.</p>
      </Modal>
    </main>
  </AdminShell>;
}
