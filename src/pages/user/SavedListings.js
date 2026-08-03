import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { Button, StatusMessage } from '../../ui/primitives';
import UserShell from './UserShell';
import './SavedListings.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

function mapSavedItems(savedRows, itemRows, imageRows) {
  const itemsById = new Map((itemRows || []).map((item) => [item.id, item]));
  const imagesByItemId = new Map();

  (imageRows || []).forEach((image) => {
    const current = imagesByItemId.get(image.item_id) || [];
    current.push(image);
    imagesByItemId.set(image.item_id, current);
  });

  return (savedRows || []).map((savedRow) => {
    const item = itemsById.get(savedRow.item_id) || null;
    const images = (imagesByItemId.get(savedRow.item_id) || [])
      .slice()
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);

    return {
      ...savedRow,
      item,
      primaryImage: images[0] || null,
    };
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

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      const userId = authData?.user?.id;
      if (!userId) {
        navigate('/login');
        return;
      }

      const savedResult = await supabase
        .from('saved_rent_items')
        .select('id, item_id, desired_quantity, note, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!mounted) return;

      const savedMissingTable = savedResult.error && /does not exist|relation/i.test(String(savedResult.error.message || ''));
      if (savedResult.error && !savedMissingTable) {
        setError(savedResult.error.message);
        setLoading(false);
        return;
      }

      const savedRows = savedResult.data || [];
      const itemIds = Array.from(new Set(savedRows.map((row) => row.item_id).filter(Boolean)));

      if (!itemIds.length) {
        setSavedListings([]);
        setLoading(false);
        return;
      }

      const [itemsResult, imagesResult] = await Promise.all([
        supabase
          .from('items')
          .select('id, title, rental_price_per_day, quantity, status, is_active')
          .in('id', itemIds),
        supabase
          .from('item_images')
          .select('id, item_id, image_url, is_primary, sort_order')
          .in('item_id', itemIds)
          .order('sort_order', { ascending: true }),
      ]);

      if (!mounted) return;

      const nextErrors = [];
      if (itemsResult.error) nextErrors.push(`items: ${itemsResult.error.message}`);
      if (imagesResult.error) nextErrors.push(`item images: ${imagesResult.error.message}`);

      setSavedListings(mapSavedItems(savedRows, itemsResult.data || [], imagesResult.data || []));
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadSavedListings();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const savedCount = useMemo(() => savedListings.length, [savedListings.length]);

  return (
    <UserShell>
      <div className="saved-listings-page">
        <div className="saved-listings-header">
          <h1>Saved Listings</h1>
          <span>{savedCount}</span>
        </div>

        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        {loading ? <StatusMessage tone="info">Loading your saved listings.</StatusMessage> : null}

        {!loading && !savedListings.length ? <StatusMessage tone="info">You do not have saved listings yet.</StatusMessage> : null}

        {savedListings.length ? (
          <div className="saved-listings-grid">
            {savedListings.map((savedListing) => {
              const item = savedListing.item;
              const availableQuantity = Number(item?.quantity || 0);

              return (
                <article key={savedListing.id}>
                  <div className="saved-listings-image">
                    {savedListing.primaryImage?.image_url ? <img alt={item?.title || 'Saved listing'} src={savedListing.primaryImage.image_url} /> : <span>Item</span>}
                  </div>
                  <div className="saved-listings-body">
                    <strong>{item?.title || 'Unavailable listing'}</strong>
                    <span>{currencyFormatter.format(Number(item?.rental_price_per_day) || 0)} / day</span>
                    <small>
                      Desired quantity: {savedListing.desired_quantity} • Available: {availableQuantity}
                    </small>
                    <small>Status: {item?.is_active ? 'Active' : 'Inactive'}</small>
                    <Button onClick={() => navigate(`/user/view-item-list/${savedListing.item_id}`)} type="button" variant="secondary">
                      View Item
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </UserShell>
  );
}
