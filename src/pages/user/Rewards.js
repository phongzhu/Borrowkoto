import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { Button, StatusMessage } from '../../ui/primitives';
import UserShell from './UserShell';
import './Rewards.css';

const money = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });

export default function Rewards() {
  const [account, setAccount] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('redeem');

  const loadRewards = useCallback(async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) { setLoading(false); return; }
    const [accountResult, catalogResult, voucherResult] = await Promise.all([
      supabase.from('borrower_reward_accounts').select('*').eq('borrower_id', userId).maybeSingle(),
      supabase.from('reward_voucher_catalog').select('*').eq('is_active', true).order('points_cost'),
      supabase.from('borrower_vouchers').select('*, reward_voucher_catalog(name)').eq('borrower_id', userId).order('issued_at', { ascending: false }),
    ]);
    setAccount(accountResult.data || { completed_borrow_count: 0, points_balance: 0 });
    setCatalog(catalogResult.data || []);
    setVouchers(voucherResult.data || []);
    setMessage(accountResult.error || catalogResult.error || voucherResult.error ? 'Deploy the rewards migration to enable this page.' : '');
    setLoading(false);
  }, []);

  useEffect(() => { loadRewards(); }, [loadRewards]);

  async function redeem(voucher) {
    setMessage('');
    const { error } = await supabase.rpc('redeem_reward_voucher', { requested_voucher_id: voucher.id });
    if (error) { setMessage(error.message); return; }
    setMessage(`${voucher.name} was added to your vouchers.`);
    loadRewards();
  }

  return <UserShell subtitle="" title="">
    <main className="rewards-page">
      {message ? <StatusMessage tone="info">{message}</StatusMessage> : null}
      {loading ? <StatusMessage tone="info">Loading rewards…</StatusMessage> : <>
        <section className="rewards-stats">
          <article><span>Available points</span><strong>{account?.points_balance || 0}</strong></article>
          <article><span>Completed rentals</span><strong>{account?.completed_borrow_count || 0}</strong></article>
        </section>

        <section className="rewards-tab-panel">
          <div aria-label="Voucher sections" className="rewards-tabs" role="tablist">
            <button aria-controls="redeem-vouchers-panel" aria-selected={activeTab === 'redeem'} className={activeTab === 'redeem' ? 'active' : ''} id="redeem-vouchers-tab" onClick={() => setActiveTab('redeem')} role="tab" type="button">Redeem vouchers</button>
            <button aria-controls="my-vouchers-panel" aria-selected={activeTab === 'mine'} className={activeTab === 'mine' ? 'active' : ''} id="my-vouchers-tab" onClick={() => setActiveTab('mine')} role="tab" type="button">My vouchers <span>{vouchers.length}</span></button>
          </div>

          {activeTab === 'redeem' ? <div aria-labelledby="redeem-vouchers-tab" className="rewards-tab-content" id="redeem-vouchers-panel" role="tabpanel">
            <div className="rewards-section-title"><h2>Redeem a voucher</h2><p>Vouchers remain valid for the period shown after redemption.</p></div>
            <div className="reward-card-grid">{catalog.map((voucher) => <article className="reward-card" key={voucher.id}><div className="reward-voucher-main"><span className="reward-points">{voucher.points_cost} points</span><h3>{voucher.name}</h3><p>{voucher.description}</p><small>Minimum rental: {money.format(voucher.minimum_rental_amount || 0)} · Valid {voucher.validity_days} days</small></div><div className="reward-voucher-stub"><span>Reward voucher</span><b>{voucher.discount_type === 'percentage' ? `${Number(voucher.discount_value)}% OFF` : `${money.format(voucher.discount_value)} OFF`}</b><Button disabled={(account?.points_balance || 0) < voucher.points_cost} onClick={() => redeem(voucher)}>Redeem</Button></div></article>)}</div>
          </div> : null}

          {activeTab === 'mine' ? <div aria-labelledby="my-vouchers-tab" className="rewards-tab-content" id="my-vouchers-panel" role="tabpanel">
            <div className="rewards-section-title"><h2>My vouchers</h2><p>View your available, used, and expired rental vouchers.</p></div>
            <div className="reward-voucher-list">{vouchers.length ? vouchers.map((voucher) => <article key={voucher.id}><div><strong>{voucher.reward_voucher_catalog?.name || 'Rental voucher'}</strong><span>{voucher.code}</span></div><div><b>{voucher.status}</b><small>Expires {new Date(voucher.expires_at).toLocaleDateString('en-PH')}</small></div></article>) : <p className="reward-empty-state">No vouchers redeemed yet.</p>}</div>
          </div> : null}
        </section>
      </>}
    </main>
  </UserShell>;
}
