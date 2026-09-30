import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { Badge, Button, FormField, Input, Modal, StatusMessage, Textarea } from '../../ui/primitives';
import { GearIcon } from '../../ui/icons';
import AdminShell from './AdminShell';
import './PromotionSettings.css';

const emptyPlan = { description: '', duration_days: '', fee: '', is_active: true, name: '' };
const money = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });

function getPromotionStatus(request) {
  return request.status === 'active' && (!request.ends_at || new Date(request.ends_at) <= new Date())
    ? 'ended'
    : request.status;
}

export default function PromotionSettings() {
  const [plans, setPlans] = useState([]);
  const [requests, setRequests] = useState([]);
  const [settings, setSettings] = useState({ banner_slot_limit: 8, rotation_interval_seconds: 8 });
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planModal, setPlanModal] = useState(null);
  const [deletePlan, setDeletePlan] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('plans');
  const [planSearch, setPlanSearch] = useState('');
  const [planStatusFilter, setPlanStatusFilter] = useState('all');
  const [planSort, setPlanSort] = useState('duration_asc');
  const [requestSearch, setRequestSearch] = useState('');
  const [requestStatusFilter, setRequestStatusFilter] = useState('all');
  const [requestSort, setRequestSort] = useState('newest');

  const notify = (text, tone = 'info') => { setMessage(text); setMessageTone(tone); };

  const load = useCallback(async () => {
    setLoading(true);
    const [planResult, settingsResult, requestResult] = await Promise.all([
      supabase.from('promotion_plans').select('*').order('sort_order').order('duration_days'),
      supabase.from('promotion_settings').select('*').eq('id', true).maybeSingle(),
      supabase.from('item_promotions').select('*,items(title),profiles!item_promotions_lender_id_fkey(username)').order('created_at', { ascending: false }),
    ]);
    setPlans(planResult.data || []);
    setRequests(requestResult.data || []);
    if (settingsResult.data) setSettings(settingsResult.data);
    const error = planResult.error || settingsResult.error || requestResult.error;
    if (error) notify(error.message, 'danger');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const nextSortOrder = useMemo(
    () => Math.max(0, ...plans.map((plan) => Number(plan.sort_order) || 0)) + 1,
    [plans]
  );

  const visiblePlans = useMemo(() => {
    const query = planSearch.trim().toLowerCase();
    const filtered = plans.filter((plan) => {
      if (planStatusFilter === 'active' && !plan.is_active) return false;
      if (planStatusFilter === 'inactive' && plan.is_active) return false;
      return !query || `${plan.name} ${plan.description || ''}`.toLowerCase().includes(query);
    });
    return filtered.sort((left, right) => {
      if (planSort === 'name_asc') return String(left.name).localeCompare(String(right.name));
      if (planSort === 'fee_asc') return Number(left.fee) - Number(right.fee);
      if (planSort === 'fee_desc') return Number(right.fee) - Number(left.fee);
      if (planSort === 'duration_desc') return Number(right.duration_days) - Number(left.duration_days);
      return Number(left.duration_days) - Number(right.duration_days);
    });
  }, [planSearch, planSort, planStatusFilter, plans]);

  const visibleRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase();
    return requests
      .filter((request) => {
        const status = getPromotionStatus(request);
        if (requestStatusFilter !== 'all' && status !== requestStatusFilter) return false;
        const haystack = `${request.items?.title || ''} ${request.profiles?.username || ''} ${status || ''}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .sort((left, right) => {
        const leftDate = new Date(left.created_at || left.starts_at || 0).getTime() || 0;
        const rightDate = new Date(right.created_at || right.starts_at || 0).getTime() || 0;
        return requestSort === 'oldest' ? leftDate - rightDate : rightDate - leftDate;
      });
  }, [requestSearch, requestSort, requestStatusFilter, requests]);

  function openAddPlan() {
    setPlanModal({ mode: 'add', values: { ...emptyPlan, sort_order: nextSortOrder } });
  }

  function openEditPlan(plan) {
    setPlanModal({ mode: 'edit', values: { ...plan } });
  }

  function updatePlanField(field, value) {
    setPlanModal((current) => ({ ...current, values: { ...current.values, [field]: value } }));
  }

  async function savePlan(event) {
    event.preventDefault();
    const values = planModal.values;
    const durationDays = Number(values.duration_days);
    const fee = Number(values.fee);
    if (!values.name.trim() || !Number.isInteger(durationDays) || durationDays < 1 || !Number.isFinite(fee) || fee < 0) {
      notify('Enter a plan name, at least one day, and a valid non-negative fee.', 'danger');
      return;
    }

    setSavingPlan(true);
    const payload = {
      description: values.description.trim() || null,
      duration_days: durationDays,
      fee,
      is_active: Boolean(values.is_active),
      name: values.name.trim(),
      sort_order: Number(values.sort_order) || nextSortOrder,
      updated_at: new Date().toISOString(),
    };
    const result = planModal.mode === 'add'
      ? await supabase.from('promotion_plans').insert(payload).select().single()
      : await supabase.from('promotion_plans').update(payload).eq('id', values.id).select().single();
    setSavingPlan(false);
    if (result.error) {
      notify(result.error.code === '23505' ? 'A promotion plan with that duration already exists.' : result.error.message, 'danger');
      return;
    }
    setPlanModal(null);
    notify(`Promotion plan ${planModal.mode === 'add' ? 'added' : 'updated'} successfully.`, 'success');
    load();
  }

  async function removePlan() {
    setSavingPlan(true);
    const { error } = await supabase.from('promotion_plans').delete().eq('id', deletePlan.id);
    setSavingPlan(false);
    if (error) {
      setDeletePlan(null);
      notify(error.code === '23503' ? 'This plan has promotion history and cannot be deleted. Set it to inactive instead.' : error.message, 'danger');
      return;
    }
    setDeletePlan(null);
    notify('Promotion plan deleted.', 'success');
    load();
  }

  async function saveGlobalSettings() {
    setSavingSettings(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('promotion_settings').update({
      banner_slot_limit: Number(settings.banner_slot_limit),
      rotation_interval_seconds: Number(settings.rotation_interval_seconds),
      updated_at: new Date().toISOString(),
      updated_by: auth.user?.id || null,
    }).eq('id', true);
    setSavingSettings(false);
    notify(error ? error.message : 'Banner settings saved.', error ? 'danger' : 'success');
    if (!error) setSettingsOpen(false);
  }

  async function review(request, status) {
    if (status === 'active') {
      const activeCount = requests.filter((entry) => entry.status === 'active' && new Date(entry.ends_at) > new Date()).length;
      if (activeCount >= Number(settings.banner_slot_limit)) return notify('All configured banner slots are currently occupied.', 'warning');
    }
    const { data: auth } = await supabase.auth.getUser();
    const startsAt = new Date();
    const changes = status === 'active' ? {
      approved_by: auth.user.id, ends_at: new Date(startsAt.getTime() + Number(request.duration_days_snapshot) * 86400000).toISOString(),
      starts_at: startsAt.toISOString(), status, updated_at: new Date().toISOString(),
    } : { approved_by: auth.user.id, status, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('item_promotions').update(changes).eq('id', request.id);
    if (error) return notify(error.message, 'danger');
    notify(`Promotion ${status === 'active' ? 'activated' : 'rejected'}.`, 'success');
    load();
  }

  return (
    <AdminShell subtitle="" title="">
      <main className="promotion-admin-page">
        {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

        <div aria-label="Promotion management sections" className="promotion-inner-tabs" role="tablist">
          <button aria-controls="promotion-plans-panel" aria-selected={activeTab === 'plans'} className={activeTab === 'plans' ? 'active' : ''} id="promotion-plans-tab" onClick={() => setActiveTab('plans')} role="tab" type="button">
            Plans <span>{plans.length}</span>
          </button>
          <button aria-controls="promotion-requests-panel" aria-selected={activeTab === 'requests'} className={activeTab === 'requests' ? 'active' : ''} id="promotion-requests-tab" onClick={() => setActiveTab('requests')} role="tab" type="button">
            Requests <span>{requests.length}</span>
          </button>
        </div>

        {activeTab === 'plans' ? (
        <section aria-labelledby="promotion-plans-tab" className="promotion-admin-card" id="promotion-plans-panel" role="tabpanel">
          <div className="promotion-section-heading"><div><h2>Promotion plans</h2><p>{visiblePlans.length} of {plans.length} pricing options</p></div><div className="promotion-header-actions"><Button onClick={openAddPlan}>+ Add promotion plan</Button><button aria-label="Open banner display settings" className="promotion-settings-button" onClick={() => setSettingsOpen(true)} title="Banner display settings" type="button"><GearIcon size={20} /></button></div></div>
          <div className="promotion-table-toolbar">
            <label><span>Search plans</span><Input aria-label="Search promotion plans" onChange={(event) => setPlanSearch(event.target.value)} placeholder="Plan name or description" value={planSearch} /></label>
            <label><span>Plan status</span><select aria-label="Filter plans by status" onChange={(event) => setPlanStatusFilter(event.target.value)} value={planStatusFilter}><option value="all">All plans</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <label><span>Sort plans</span><select aria-label="Sort promotion plans" onChange={(event) => setPlanSort(event.target.value)} value={planSort}><option value="duration_asc">Duration: shortest first</option><option value="duration_desc">Duration: longest first</option><option value="name_asc">Name: A to Z</option><option value="fee_asc">Fee: lowest first</option><option value="fee_desc">Fee: highest first</option></select></label>
          </div>
          <div className="promotion-table-wrap">
            <table className="promotion-table">
              <thead><tr><th>Plan</th><th>Duration</th><th>Fee</th><th>Status</th><th className="promotion-actions-column">Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="5" className="promotion-empty">Loading promotion plans…</td></tr> : null}
                {!loading && !plans.length ? <tr><td colSpan="5" className="promotion-empty">No promotion plans yet. Add the first plan to get started.</td></tr> : null}
                {!loading && plans.length > 0 && !visiblePlans.length ? <tr><td colSpan="5" className="promotion-empty">No plans match these filters.</td></tr> : null}
                {!loading && visiblePlans.map((plan) => (
                  <tr key={plan.id}>
                    <td><strong>{plan.name}</strong><span className="promotion-plan-description">{plan.description || 'No description'}</span></td>
                    <td>{plan.duration_days} day{plan.duration_days === 1 ? '' : 's'}</td>
                    <td className="promotion-fee">{money.format(plan.fee)}</td>
                    <td><Badge tone={plan.is_active ? 'success' : 'neutral'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td><div className="promotion-row-actions"><Button onClick={() => openEditPlan(plan)} variant="secondary">Edit</Button><Button onClick={() => setDeletePlan(plan)} variant="ghost">Delete</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        {activeTab === 'requests' ? (
        <section aria-labelledby="promotion-requests-tab" className="promotion-admin-card" id="promotion-requests-panel" role="tabpanel">
          <div className="promotion-section-heading"><div><h2>Promotion requests</h2><p>{visibleRequests.length} of {requests.length} requests · Review lender requests for available banner slots.</p></div></div>
          <div className="promotion-table-toolbar promotion-request-toolbar">
            <label><span>Search requests</span><Input aria-label="Search promotion requests" onChange={(event) => setRequestSearch(event.target.value)} placeholder="Listing, lender, or status" value={requestSearch} /></label>
            <label><span>Request status</span><select aria-label="Filter requests by status" onChange={(event) => setRequestStatusFilter(event.target.value)} value={requestStatusFilter}><option value="all">All statuses</option><option value="pending_payment">Pending payment</option><option value="payment_review">Payment review</option><option value="active">Active</option><option value="ended">Ended</option><option value="rejected">Rejected</option></select></label>
            <label><span>Sort requests</span><select aria-label="Sort promotion requests by date" onChange={(event) => setRequestSort(event.target.value)} value={requestSort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          </div>
          <div className="promotion-request-list">
            {loading ? <p className="promotion-empty">Loading promotion requests…</p> : null}
            {!loading && !requests.length ? <p className="promotion-empty">No promotion requests yet.</p> : null}
            {!loading && requests.length > 0 && !visibleRequests.length ? <p className="promotion-empty">No requests match these filters.</p> : null}
            {!loading && visibleRequests.map((request) => {
              const promotionStatus = getPromotionStatus(request);
              return <article key={request.id}>
                <div><strong>{request.items?.title || 'Listing'}</strong><span>{request.profiles?.username || 'Lender'} · {money.format(request.fee_snapshot)} · {request.duration_days_snapshot} days</span></div>
                <Badge tone={promotionStatus === 'active' ? 'success' : 'neutral'}>{promotionStatus.replaceAll('_', ' ')}</Badge>
                <div className="promotion-row-actions">{['pending_payment', 'payment_review'].includes(request.status) ? <><Button onClick={() => review(request, 'rejected')} variant="ghost">Reject</Button><Button onClick={() => review(request, 'active')}>Activate</Button></> : <span>{request.ends_at ? `Ends ${new Date(request.ends_at).toLocaleDateString('en-PH')}` : ''}</span>}</div>
              </article>;
            })}
          </div>
        </section>
        ) : null}

        <Modal actions={<><Button onClick={() => setPlanModal(null)} variant="ghost">Cancel</Button><Button disabled={savingPlan} onClick={savePlan}>{savingPlan ? 'Saving…' : planModal?.mode === 'add' ? 'Add plan' : 'Save changes'}</Button></>} onClose={() => setPlanModal(null)} open={Boolean(planModal)} size="compact" title={planModal?.mode === 'add' ? 'Add promotion plan' : 'Edit promotion plan'}>
          {planModal ? <form className="promotion-plan-form" onSubmit={savePlan}><FormField label="Plan name"><Input autoFocus onChange={(e) => updatePlanField('name', e.target.value)} required value={planModal.values.name} /></FormField><div className="promotion-plan-form-row"><FormField label="Duration (days)"><Input min="1" onChange={(e) => updatePlanField('duration_days', e.target.value)} required type="number" value={planModal.values.duration_days} /></FormField><FormField label="Fee (PHP)"><Input min="0" onChange={(e) => updatePlanField('fee', e.target.value)} required step="0.01" type="number" value={planModal.values.fee} /></FormField></div><FormField label="Description"><Textarea onChange={(e) => updatePlanField('description', e.target.value)} value={planModal.values.description || ''} /></FormField><label className="promotion-active-toggle"><input checked={planModal.values.is_active} onChange={(e) => updatePlanField('is_active', e.target.checked)} type="checkbox" /><span><strong>Active plan</strong><small>Visible to lenders when requesting a promotion.</small></span></label><button className="promotion-hidden-submit" type="submit">Submit</button></form> : null}
        </Modal>

        <Modal actions={<><Button onClick={() => setDeletePlan(null)} variant="ghost">Cancel</Button><Button disabled={savingPlan} onClick={removePlan} variant="danger">{savingPlan ? 'Deleting…' : 'Delete plan'}</Button></>} onClose={() => setDeletePlan(null)} open={Boolean(deletePlan)} size="compact" title="Delete promotion plan?">
          <p className="promotion-delete-copy">Delete <strong>{deletePlan?.name}</strong>? This cannot be undone. Plans already used in a promotion cannot be deleted and should be made inactive instead.</p>
        </Modal>

        <Modal actions={<><Button onClick={() => setSettingsOpen(false)} variant="ghost">Cancel</Button><Button disabled={savingSettings} onClick={saveGlobalSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</Button></>} onClose={() => setSettingsOpen(false)} open={settingsOpen} size="compact" title="Banner display settings">
          <div className="promotion-settings-form">
            <p>Control how many paid promotions can run and how they rotate on the public banner.</p>
            <FormField hint="The maximum number of promoted listings that may be active at the same time." label="Active promotion limit" required><Input min="1" onChange={(e) => setSettings((current) => ({ ...current, banner_slot_limit: e.target.value }))} required type="number" value={settings.banner_slot_limit} /></FormField>
            <FormField hint="How long one promoted listing is shown before the banner switches to the next." label="Seconds per banner" required><Input max="120" min="3" onChange={(e) => setSettings((current) => ({ ...current, rotation_interval_seconds: e.target.value }))} required type="number" value={settings.rotation_interval_seconds} /></FormField>
          </div>
        </Modal>
      </main>
    </AdminShell>
  );
}
