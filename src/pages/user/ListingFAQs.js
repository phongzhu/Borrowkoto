import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { MessageIcon, SearchIcon } from '../../ui/icons';
import { Badge, Button, FormField, Input, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import UserShell from './UserShell';
import './ListingFAQs.css';

const FAQ_TEMPLATES = [
  { key: 'availability', label: 'Availability', question: 'Is this item available on my preferred dates?', answer: 'Availability depends on the selected dates. Check the booking calendar or send your intended pickup and return dates for confirmation.' },
  { key: 'deposit', label: 'Deposit', question: 'Is a security deposit required?', answer: 'Yes. The refundable security deposit is shown on the listing and is returned according to the rental terms after the item is checked.' },
  { key: 'pickup', label: 'Pickup', question: 'Where and when can I pick up the item?', answer: 'Pickup details are shown on the listing. The exact meetup time and location will be confirmed after the booking is approved.' },
  { key: 'condition', label: 'Condition', question: 'What condition is the item in?', answer: 'The current condition is described in the listing and photos. Please review them before booking and ask if you need a specific detail checked.' },
  { key: 'usage', label: 'Usage', question: 'Are there any usage restrictions?', answer: 'Use the item only for its intended purpose and follow the included care instructions. Ask before booking if you plan to use it for a special activity.' },
];

function emptyFaq() { return { answer: '', question: '' }; }
function formatDate(value) {
  if (!value) return 'Not configured';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not configured' : date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ListingFAQs() {
  const [items, setItems] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [saving, setSaving] = useState(false);

  async function loadData(showLoader = true) {
    if (showLoader) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sign in to manage listing FAQs.'); setLoading(false); return; }
    const itemsResult = await supabase.from('items').select('id, title, status, is_active, updated_at').eq('owner_id', user.id).order('updated_at', { ascending: false });
    const itemRows = itemsResult.data || [];
    const itemIds = itemRows.map((item) => item.id);
    const faqResult = itemIds.length
      ? await supabase.from('item_faqs').select('id, item_id, question, answer, sort_order, updated_at').in('item_id', itemIds).order('sort_order', { ascending: true })
      : { data: [], error: null };
    setItems(itemRows);
    setFaqs(faqResult.data || []);
    setError([itemsResult.error?.message, faqResult.error?.message].filter(Boolean).join(' '));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const faqMap = useMemo(() => {
    const map = new Map();
    faqs.forEach((faq) => map.set(faq.item_id, [...(map.get(faq.item_id) || []), faq]));
    return map;
  }, [faqs]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => [item.title, item.status, ...(faqMap.get(item.id) || []).flatMap((faq) => [faq.question, faq.answer])].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [faqMap, items, search]);

  function openManager(item) {
    setSelectedItem(item);
    setMessage('');
    setDrafts((faqMap.get(item.id) || []).map((faq) => ({ answer: faq.answer, question: faq.question })));
  }
  function closeManager() { setSelectedItem(null); setDrafts([]); setSaving(false); }
  function updateDraft(index, field, value) { setDrafts((current) => current.map((faq, faqIndex) => faqIndex === index ? { ...faq, [field]: value } : faq)); }
  function addTemplate(template) {
    if (drafts.some((faq) => faq.question.trim().toLowerCase() === template.question.toLowerCase())) return;
    setDrafts((current) => [...current, { answer: template.answer, question: template.question }]);
  }

  async function saveFaqs() {
    if (!selectedItem) return;
    const prepared = drafts.reduce((rows, faq, index) => {
      const question = faq.question.trim(); const answer = faq.answer.trim();
      if (!question && !answer) return rows;
      if (!question || !answer) throw new Error(`FAQ ${index + 1} needs both a question and an answer.`);
      rows.push({ answer, is_active: true, item_id: selectedItem.id, question, sort_order: index });
      return rows;
    }, []);
    setSaving(true); setMessage('');
    try {
      const { error: deleteError } = await supabase.from('item_faqs').delete().eq('item_id', selectedItem.id);
      if (deleteError) throw deleteError;
      if (prepared.length) {
        const { error: insertError } = await supabase.from('item_faqs').insert(prepared);
        if (insertError) throw insertError;
      }
      setMessage('FAQ assistant updated. Buyers will see these answers in chat.');
      await loadData(false);
      setDrafts(prepared.map(({ answer, question }) => ({ answer, question })));
    } catch (saveError) { setMessage(saveError.message || 'Unable to save FAQs.'); }
    setSaving(false);
  }

  if (selectedItem) {
    return <UserShell title="" subtitle="">
      <Panel className="listing-faq-page listing-faq-editor-page">
        <div className="listing-faq-editor-page-head">
          <div><span className="listing-faq-eyebrow">Communication tools</span><h1>Edit listing FAQs</h1><p>{selectedItem.title}</p></div>
          <div className="listing-faq-editor-actions"><Button className="listing-faq-return-button" onClick={closeManager} variant="ghost">Return</Button><Button className="listing-faq-save-button" disabled={saving} onClick={saveFaqs}>{saving ? 'Saving...' : 'Save FAQs'}</Button></div>
        </div>
        {message ? <StatusMessage tone={message.startsWith('FAQ assistant') ? 'success' : 'warning'}>{message}</StatusMessage> : null}
        <section className="listing-faq-form-section">
          <div className="listing-faq-section-title"><MessageIcon size={18}/><div><strong>Quick action guide</strong><span>Choose a template, then modify the details for this product.</span></div></div>
          <div className="listing-faq-template-grid">{FAQ_TEMPLATES.map((template) => <button key={template.key} onClick={() => addTemplate(template)} type="button"><strong>{template.label}</strong><span>{template.question}</span></button>)}</div>
          <small className="listing-faq-guidance">Keep answers factual. Buyers still contact the lender for exceptions or details not covered here.</small>
        </section>
        <section className="listing-faq-form-section">
          <div className="listing-faq-drafts-head"><div><strong>Seller-provided answers</strong><span>{drafts.length} configured for buyer chat</span></div><Button onClick={() => setDrafts((current) => [...current, emptyFaq()])} type="button" variant="secondary">Add custom FAQ</Button></div>
          <div className="listing-faq-drafts">{drafts.length ? drafts.map((faq, index) => <article key={`faq-draft-${index}`}><header><span>{index + 1}</span><strong>FAQ entry</strong><Button onClick={() => setDrafts((current) => current.filter((_, faqIndex) => faqIndex !== index))} variant="ghost">Remove</Button></header><div className="listing-faq-fields"><FormField label="Buyer question"><Input maxLength={180} onChange={(event) => updateDraft(index, 'question', event.target.value)} value={faq.question}/></FormField><FormField label="Automatic answer"><Textarea maxLength={1000} onChange={(event) => updateDraft(index, 'answer', event.target.value)} rows={4} value={faq.answer}/></FormField></div></article>) : <StatusMessage tone="info">No FAQs configured. Use a template or add a custom question.</StatusMessage>}</div>
        </section>
      </Panel>
    </UserShell>;
  }

  return <UserShell title="" subtitle="">
    <Panel className="listing-faq-page">
      <div className="listing-faq-page-head">
        <div><span className="listing-faq-eyebrow">Communication tools</span><h1>Listing FAQs</h1><p>Prepare accurate answers buyers can open instantly from their conversation.</p></div>
        <Badge tone="info">{items.length} listing{items.length === 1 ? '' : 's'}</Badge>
      </div>
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      <div className="listing-faq-toolbar"><SearchIcon size={17}/><Input aria-label="Search listings and FAQs" onChange={(event) => setSearch(event.target.value)} placeholder="Search product, question, or answer" value={search}/></div>
      {loading ? <StatusMessage tone="info">Loading your product FAQs.</StatusMessage> : null}
      {!loading ? <div className="listing-faq-table-wrap"><table><thead><tr><th>Product listing</th><th>Status</th><th>FAQ answers</th><th>Last updated</th><th>Action</th></tr></thead><tbody>{filteredItems.map((item) => { const itemFaqs = faqMap.get(item.id) || []; const latest = itemFaqs.reduce((value, faq) => !value || new Date(faq.updated_at) > new Date(value) ? faq.updated_at : value, ''); return <tr key={item.id}><td data-label="Product"><strong>{item.title}</strong><small>Listing #{item.id.slice(0, 8)}</small></td><td data-label="Status"><Badge tone={item.is_active ? 'success' : 'warning'}>{item.status || (item.is_active ? 'Active' : 'Inactive')}</Badge></td><td data-label="FAQ answers"><strong>{itemFaqs.length}</strong><small>{itemFaqs.length ? 'Available in buyer chat' : 'Needs configuration'}</small></td><td data-label="Last updated">{formatDate(latest)}</td><td data-label="Action"><Button onClick={() => openManager(item)} type="button" variant="secondary">View / manage</Button></td></tr>; })}</tbody></table>{!filteredItems.length ? <StatusMessage tone="info">No listings match this search.</StatusMessage> : null}</div> : null}
    </Panel>
  </UserShell>;
}
