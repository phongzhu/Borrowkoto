import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { Button, FormField, Modal, StatusMessage } from '../../ui/primitives';
import UserShell from './UserShell';
import './Promotions.css';

const money = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });

async function functionErrorMessage(error, data, fallback) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const payload = await error.context.json();
      if (payload?.error) return payload.error;
    } catch (_) {
      // The response did not contain JSON; use the safer fallback below.
    }
  }
  return error?.message && !error.message.includes('non-2xx') ? error.message : fallback;
}

function isCourseScopedListing(item) {
  return Boolean(
    item?.subcategory_id
    && (item?.applies_to_all_programs || (item?.item_programs || []).some((row) => row?.program_code))
  );
}

function getPromotionDisplayStatus(request) {
  if (request.status === 'active' && (!request.ends_at || new Date(request.ends_at) <= new Date())) return 'ended';
  return request.status;
}

export default function Promotions() {
  const [items, setItems] = useState([]); const [plans, setPlans] = useState([]); const [requests, setRequests] = useState([]);
  const [itemId, setItemId] = useState(''); const [planId, setPlanId] = useState(''); const [message, setMessage] = useState(''); const [loading, setLoading] = useState(true); const [paying, setPaying] = useState(false);
  const [activeTab, setActiveTab] = useState('available');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const unavailableItemIds = useMemo(() => new Set(requests.filter((request) => {
    if (['pending_payment', 'payment_review'].includes(request.status)) return true;
    return request.status === 'active' && (!request.ends_at || new Date(request.ends_at) > new Date());
  }).map((request) => request.item_id)), [requests]);
  const promotableItems = useMemo(() => items.filter((item) => !unavailableItemIds.has(item.id)), [items, unavailableItemIds]);
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planId), [planId, plans]);

  useEffect(() => {
    if (itemId && unavailableItemIds.has(itemId)) setItemId(promotableItems[0]?.id || '');
  }, [itemId, promotableItems, unavailableItemIds]);

  async function load() {
    setLoading(true); const { data: auth } = await supabase.auth.getUser(); const userId = auth?.user?.id;
    if (!userId) { setLoading(false); return; }
    const [itemsResult, plansResult, requestResult] = await Promise.all([
      supabase.from('items').select('id,title,status,is_active,subcategory_id,applies_to_all_programs,item_programs(program_code)').eq('owner_id', userId).eq('is_active', true).eq('status', 'available').order('title'),
      supabase.from('promotion_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('item_promotions').select('*,items(title),promotion_plans(name)').eq('lender_id', userId).order('created_at', { ascending: false }),
    ]);
    const loadedItems = (itemsResult.data || []).filter(isCourseScopedListing); const loadedRequests = requestResult.data || [];
    const blockedIds = new Set(loadedRequests.filter((request) => ['pending_payment', 'payment_review'].includes(request.status) || (request.status === 'active' && (!request.ends_at || new Date(request.ends_at) > new Date()))).map((request) => request.item_id));
    const firstPromotableItem = loadedItems.find((item) => !blockedIds.has(item.id));
    setItems(loadedItems); setPlans(plansResult.data || []); setRequests(loadedRequests);
    setItemId((current) => current && !blockedIds.has(current) ? current : firstPromotableItem?.id || ''); setPlanId((current) => current || plansResult.data?.[1]?.id || plansResult.data?.[0]?.id || '');
    if (itemsResult.error || plansResult.error || requestResult.error) setMessage('The promotions page could not be loaded.'); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentState = params.get('promotion_payment');
    const promotionId = params.get('promotion_id');
    if (paymentState === 'cancelled') {
      setMessage('Promotion payment was cancelled. Your regular listing remains active and free.');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (paymentState !== 'success' || !promotionId) return;
    setPaying(true);
    supabase.functions.invoke('promotion-checkout', { body: { action: 'verify', promotion_id: promotionId } }).then(async ({ data, error }) => {
      if (error || data?.error) setMessage(await functionErrorMessage(error, data, 'The payment could not be verified. Please refresh and try again.'));
      else { setMessage('Payment confirmed. Your listing is now active on the promotion banner.'); setActiveTab('mine'); }
      setPaying(false);
      window.history.replaceState({}, '', window.location.pathname);
      load();
    });
  }, []);

  async function joinPromotion(event) {
    event.preventDefault(); setMessage(''); if (!selectedPlan || !itemId || paying) return;
    setPaying(true);
    const { data, error } = await supabase.functions.invoke('promotion-checkout', { body: { action: 'create', item_id: itemId, plan_id: selectedPlan.id, return_url: `${window.location.origin}${window.location.pathname}` } });
    if (error || data?.error || !data?.checkout_url) { setMessage(await functionErrorMessage(error, data, 'Unable to open PayMongo checkout. Please try again.')); setPaying(false); return; }
    window.location.assign(data.checkout_url);
  }

  async function cancelPromotion() {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    const { data, error } = await supabase.functions.invoke('promotion-checkout', { body: { action: 'cancel', promotion_id: cancelTarget.id } });
    setCancelling(false);
    if (error || data?.error) { setMessage(await functionErrorMessage(error, data, 'Unable to cancel this promotion.')); setCancelTarget(null); return; }
    setMessage(data?.paid ? 'Promotion stopped. The completed promotion payment remains in your history and is not automatically refunded.' : 'Pending promotion cancelled.');
    setCancelTarget(null);
    load();
  }

  if (loading) {
    return (
      <UserShell subtitle="" title="">
        <DataLoadingScreen label="Loading promotions" message="Loading your eligible listings and promotion plans from the database." title="Getting promotions" />
      </UserShell>
    );
  }

  return <UserShell subtitle="" title=""><main className="promotions-page">{message?<StatusMessage tone="info">{message}</StatusMessage>:null}
    <section className="promotions-tab-panel">
      <div className="promotions-tabs" role="tablist"><button aria-selected={activeTab==='available'} className={activeTab==='available'?'active':''} onClick={()=>setActiveTab('available')} role="tab" type="button">Available promotions</button><button aria-selected={activeTab==='mine'} className={activeTab==='mine'?'active':''} onClick={()=>setActiveTab('mine')} role="tab" type="button">My item promotions <span>{requests.length}</span></button></div>
      {activeTab==='available'?<form className="promotion-tab-content promotion-join-form" onSubmit={joinPromotion} role="tabpanel"><div className="promotion-form-heading"><div><span>Promoted listing</span><h2>Choose an item and plan</h2></div></div><div className="promotion-listing-field"><FormField hint="Only active listings with a valid NUB subcategory and applicable course scope can be promoted." label="Item to promote"><select disabled={!promotableItems.length} onChange={(e)=>setItemId(e.target.value)} required value={itemId}><option value="">{promotableItems.length?'Choose a course-scoped listing':'No eligible course-scoped listings available'}</option>{promotableItems.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></FormField></div><div className="promotion-plan-grid">{plans.map(plan=><button aria-pressed={plan.id===planId} className={plan.id===planId?'active':''} key={plan.id} onClick={()=>setPlanId(plan.id)} type="button"><span className="promotion-plan-check">{plan.id===planId?'✓':''}</span><span className="promotion-plan-duration">{plan.duration_days} days</span><strong>{plan.name}</strong><b>{money.format(plan.fee)}</b><span className="promotion-plan-description">{plan.description}</span></button>)}</div><div className="promotion-checkout-bar"><div><span>Total promotion fee</span><strong>{selectedPlan?money.format(selectedPlan.fee):'—'}</strong><small>{selectedPlan?`${selectedPlan.duration_days} days of course-relevant banner visibility`:'Select a promotion plan'}</small></div><Button className="promotion-paymongo-button" disabled={loading||paying||!itemId||!selectedPlan} type="submit">{paying?'Opening PayMongo…':'Continue to PayMongo'}</Button></div><p className="promotion-payment-note">Secure payment through PayMongo · Course eligibility is enforced before banner activation · The existing 15% rental commission remains unchanged.</p></form>:null}
      {activeTab==='mine'?<div className="promotion-tab-content" role="tabpanel"><div className="promotion-tab-heading"><h2>My item promotions</h2><p>View active promotions and previous promotion payments for your listings.</p></div><div className="promotion-history-table-wrap"><table className="promotion-history-table"><thead><tr><th>Item</th><th>Promotion plan</th><th>Fee</th><th>Status</th><th>Promotion period</th><th className="promotion-history-actions-heading">Actions</th></tr></thead><tbody>{requests.length?requests.map(request=>{const displayStatus=getPromotionDisplayStatus(request);return <tr key={request.id}><td><strong>{request.items?.title||'Listing'}</strong></td><td>{request.promotion_plans?.name||`${request.duration_days_snapshot}-day promotion`}</td><td className="promotion-history-fee">{money.format(request.fee_snapshot)}</td><td><span className={`promotion-status promotion-status-${displayStatus}`}>{displayStatus.replaceAll('_',' ')}</span></td><td><span className="promotion-period">{request.starts_at&&request.ends_at?`${new Date(request.starts_at).toLocaleDateString('en-PH')} – ${new Date(request.ends_at).toLocaleDateString('en-PH')}`:request.status==='pending_payment'?'Starts after payment':'—'}</span></td><td><div className="promotion-table-action">{['pending_payment','active'].includes(request.status)&&displayStatus!=='ended'?<Button onClick={()=>setCancelTarget(request)} variant="ghost">Cancel</Button>:<span>—</span>}</div></td></tr>;}):<tr><td className="promotion-empty-state" colSpan="6">You have not promoted an item yet.</td></tr>}</tbody></table></div></div>:null}
    </section>
    <Modal actions={<><Button onClick={()=>setCancelTarget(null)} variant="ghost">Keep promotion</Button><Button disabled={cancelling} onClick={cancelPromotion} variant="danger">{cancelling?'Cancelling…':'Cancel promotion'}</Button></>} onClose={()=>setCancelTarget(null)} open={Boolean(cancelTarget)} size="compact" title="Cancel this promotion?">
      {cancelTarget?.status==='active'?<p>This stops the paid promotion immediately. It does not automatically refund the promotion fee.</p>:<p>This removes the unpaid promotion request. No payment will be collected.</p>}
    </Modal>
  </main></UserShell>;
}
