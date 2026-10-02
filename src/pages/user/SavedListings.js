import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { Button, StatusMessage } from '../../ui/primitives';
import { filterListingsByActiveOwners } from '../../utils/marketplaceVisibility';
import UserShell from './UserShell';
import './SavedListings.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });
const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });

function mapSavedItems(savedRows, itemRows, imageRows, promotedIds = new Set()) {
  const itemsById = new Map((itemRows || []).map((item) => [item.id, item]));
  const imagesByItemId = new Map();
  (imageRows || []).forEach((image) => {
    const current = imagesByItemId.get(image.item_id) || [];
    current.push(image);
    imagesByItemId.set(image.item_id, current);
  });

  return (savedRows || []).map((savedRow) => {
    const images = (imagesByItemId.get(savedRow.item_id) || []).slice().sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
    return { ...savedRow, item: itemsById.get(savedRow.item_id) || null, isPromoted: promotedIds.has(savedRow.item_id), primaryImage: images[0] || null };
  });
}

export default function SavedListings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedListings, setSavedListings] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function loadSavedListings() {
      setLoading(true);
      setError('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError) { setError(authError.message); setLoading(false); return; }
      const userId = authData?.user?.id;
      if (!userId) { navigate('/login'); return; }

      const savedResult = await supabase.from('saved_rent_items').select('id, item_id, desired_quantity, note, created_at, updated_at').eq('user_id', userId).order('created_at', { ascending: false });
      if (!mounted) return;
      const savedMissingTable = savedResult.error && /does not exist|relation/i.test(String(savedResult.error.message || ''));
      if (savedResult.error && !savedMissingTable) { setError(savedResult.error.message); setLoading(false); return; }
      const savedRows = savedResult.data || [];
      const itemIds = [...new Set(savedRows.map((row) => row.item_id).filter(Boolean))];
      if (!itemIds.length) { setSavedListings([]); setLoading(false); return; }

      const [itemsResult, imagesResult, promotionsResult] = await Promise.all([
        supabase.from('items').select('id, owner_id, title, rental_price_per_day, quantity, status, is_active').in('id', itemIds),
        supabase.from('item_images').select('id, item_id, image_url, is_primary, sort_order').in('item_id', itemIds).order('sort_order', { ascending: true }),
        supabase.from('active_item_promotions').select('item_id').in('item_id', itemIds),
      ]);
      if (!mounted) return;
      const nextErrors = [];
      if (itemsResult.error) nextErrors.push(`items: ${itemsResult.error.message}`);
      if (imagesResult.error) nextErrors.push(`item images: ${imagesResult.error.message}`);
      if (promotionsResult.error) nextErrors.push(`active promotions: ${promotionsResult.error.message}`);
      const ownerIds = [...new Set((itemsResult.data || []).map((item) => item.owner_id).filter(Boolean))];
      const ownersResult = ownerIds.length
        ? await supabase.from('profiles').select('id, account_status').in('id', ownerIds)
        : { data: [], error: null };
      if (!mounted) return;
      if (ownersResult.error) nextErrors.push(`listing owners: ${ownersResult.error.message}`);
      const visibleItems = filterListingsByActiveOwners(itemsResult.data || [], ownersResult.data || []);
      const visibleItemIds = new Set(visibleItems.map((item) => item.id));
      const visibleSavedRows = savedRows.filter((row) => visibleItemIds.has(row.item_id));
      setSavedListings(mapSavedItems(visibleSavedRows, visibleItems, imagesResult.data || [], new Set((promotionsResult.data || []).map((row) => row.item_id))));
      setError(nextErrors.join(' '));
      setLoading(false);
    }
    loadSavedListings();
    return () => { mounted = false; };
  }, [navigate]);

  const savedCount = useMemo(() => savedListings.length, [savedListings.length]);

  if (loading) {
    return (
      <UserShell>
        <DataLoadingScreen label="Loading saved listings" message="Loading your saved listings from the database." title="Getting your saved listings" />
      </UserShell>
    );
  }

  return (
    <UserShell>
      <div className="saved-listings-page">
        <div className="saved-listings-header"><div><span>Library</span><h1>Saved Listings</h1></div><strong>{savedCount} saved</strong></div>
        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        {loading ? <DataLoadingScreen label="Loading saved listings" message="Loading your saved listings from the database." title="Getting your saved listings" /> : null}
        {!loading && !savedListings.length ? <StatusMessage tone="info">You do not have saved listings yet.</StatusMessage> : null}
        {savedListings.length ? (
          <div className="saved-listings-table-wrap">
            <table className="saved-listings-table">
              <thead><tr><th>Item</th><th>Price</th><th>Desired</th><th>Available</th><th>Status</th><th>Promotion</th><th>Saved</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>{savedListings.map((savedListing) => {
                const item = savedListing.item;
                const active = Boolean(item?.is_active);
                return (
                  <tr key={savedListing.id}>
                    <td data-label="Item"><div className="saved-listings-item"><div className="saved-listings-image">{savedListing.primaryImage?.image_url ? <img alt={item?.title || 'Saved listing'} src={savedListing.primaryImage.image_url} /> : <span>Item</span>}</div><div><strong>{item?.title || 'Unavailable listing'}</strong><small>Listing #{String(savedListing.item_id || '').slice(0, 8)}</small></div></div></td>
                    <td data-label="Price"><strong className="saved-listings-price">{currencyFormatter.format(Number(item?.rental_price_per_day) || 0)}</strong><small>/ day</small></td>
                    <td data-label="Desired">{savedListing.desired_quantity || 1}</td><td data-label="Available">{Number(item?.quantity || 0)}</td>
                    <td data-label="Status"><span className={`saved-listings-status ${active ? 'active' : 'inactive'}`}>{active ? 'Active' : 'Inactive'}</span></td>
                    <td data-label="Promotion"><span className={`saved-listings-promotion ${savedListing.isPromoted ? 'promoted' : ''}`}>{savedListing.isPromoted ? 'Promoted' : 'Standard'}</span></td>
                    <td data-label="Saved">{savedListing.created_at ? dateFormatter.format(new Date(savedListing.created_at)) : '—'}</td>
                    <td data-label="Action"><Button onClick={() => navigate(`/user/view-item-list/${savedListing.item_id}`)} type="button" variant="secondary">View item</Button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : null}
      </div>
    </UserShell>
  );
}
