import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { ArrowRightIcon, SearchIcon, UploadIcon } from '../../ui/icons';
import { Button, StarRating, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import UserShell from './UserShell';
import './Messages.css';

const MESSAGE_ATTACHMENTS_BUCKET = 'item-images';
const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const chatViewportHeight = 'calc(100dvh - clamp(116px, 10vw, 132px))';

function buildPersonName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function buildInitials(profile) {
  const parts = [profile?.first_name, profile?.last_name].filter(Boolean);

  if (!parts.length) {
    return 'CM';
  }

  return parts
    .map((part) => String(part).trim().charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

function formatDateTime(value) {
  if (!value) {
    return 'Not set';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return dateTimeFormatter.format(parsed);
}

function formatThreadTime(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const now = new Date();
  const isSameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (isSameDay) {
    return timeFormatter.format(parsed);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatLabel(value, fallback = 'Not set') {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getAdaptiveNameSize(name, regular, compact, dense) {
  const length = String(name || '').trim().length;

  if (length > 44) {
    return dense;
  }

  if (length > 30) {
    return compact;
  }

  return regular;
}

function isImageAttachment(url) {
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(String(url || ''));
}

function buildAttachmentLabel(url) {
  const normalized = String(url || '').trim();

  if (!normalized) {
    return 'Attachment';
  }

  const cleanUrl = normalized.split('?')[0];
  const fileName = cleanUrl.split('/').pop() || 'Attachment';
  const decoded = decodeURIComponent(fileName);
  const label = decoded.replace(/^\d+-/, '');

  return label || 'Attachment';
}

function buildLastMessagePreview(message) {
  const preview = String(message?.message_text || '').trim();

  if (!preview && message?.attachment_url) {
    return isImageAttachment(message.attachment_url) ? 'Sent a photo' : 'Sent an attachment';
  }

  if (!preview) {
    return 'Open the thread to start chatting about the item.';
  }

  return preview.length > 72 ? `${preview.slice(0, 72).trim()}...` : preview;
}

function getThreadActivityTime(thread) {
  return new Date(thread.lastMessage?.sent_at || thread.created_at || 0).getTime();
}

function buildThreadKey(thread) {
  const memberIds = (thread.members || [])
    .map((member) => member.user_id)
    .filter(Boolean)
    .sort();

  if (memberIds.length) {
    return memberIds.join(':');
  }

  return thread.id;
}

function ThreadListItem({ active, onSelect, thread }) {
  const otherParticipantName = buildPersonName(thread.otherParticipant) || 'Community member';
  const initials = buildInitials(thread.otherParticipant);
  const threadTime = formatThreadTime(thread.lastMessage?.sent_at || thread.created_at);
  const itemTitle = thread.itemSummary || thread.item?.title || 'Marketplace thread';
  const preview = buildLastMessagePreview(thread.lastMessage);
  const nameFontSize = getAdaptiveNameSize(otherParticipantName, 16, 14, 13);

  return (
    <button
      className={`message-thread-card${active ? ' active' : ''}`}
      onClick={onSelect}
      style={{
        alignSelf: 'start',
        background: active ? alpha(theme.colors.sky, 0.12) : alpha(theme.colors.panel, 0.72),
        border: `1px solid ${active ? alpha(theme.colors.sky, 0.18) : alpha(theme.colors.ink, 0.06)}`,
        borderRadius: 22,
        boxShadow: active ? '0 18px 34px rgba(24, 33, 46, 0.12)' : 'none',
        cursor: 'pointer',
        display: 'grid',
        gap: 10,
        minHeight: 112,
        padding: 14,
        textAlign: 'left',
        transition: 'background 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
        width: '100%',
      }}
      type="button"
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 12, minWidth: 0 }}>
        <div
          style={{
            alignItems: 'center',
            background: active ? alpha(theme.colors.sky, 0.18) : alpha(theme.colors.sky, 0.1),
            borderRadius: '50%',
            color: theme.colors.sky,
            display: 'inline-flex',
            flexShrink: 0,
            height: 52,
            justifyContent: 'center',
            overflow: 'hidden',
            width: 52,
          }}
        >
          {thread.otherParticipant?.profile_photo_url ? (
            <img
              alt={otherParticipantName}
              src={thread.otherParticipant.profile_photo_url}
              style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }}
            />
          ) : (
            <span style={{ fontSize: 15, fontWeight: 700 }}>{initials}</span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <div style={{ alignItems: 'start', display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
            <strong
              style={{
                color: theme.colors.ink,
                fontSize: nameFontSize,
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
            >
              {otherParticipantName}
            </strong>
            <span style={{ color: theme.colors.slate, fontSize: 12, paddingTop: 1, whiteSpace: 'nowrap' }}>{threadTime}</span>
          </div>

          <span
            style={{
              color: theme.colors.ink,
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {itemTitle}
          </span>

          <div style={{ alignItems: 'center', display: 'flex', gap: 10, minWidth: 0 }}>
            <span
              style={{
                color: theme.colors.slate,
                display: '-webkit-box',
                fontSize: 13,
                lineHeight: 1.4,
                minWidth: 0,
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 1,
              }}
            >
              {preview}
            </span>
            {thread.unreadCount ? (
              <span
                style={{
                  alignItems: 'center',
                  background: alpha(theme.colors.teal, 0.18),
                  borderRadius: theme.radius.pill,
                  color: theme.colors.teal,
                  display: 'inline-flex',
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  height: 20,
                  justifyContent: 'center',
                  minWidth: 20,
                  padding: '0 6px',
                }}
              >
                {thread.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function ItemContextCard({ item, items = [], linkedItemCount, onOpenItem, onSelectItem, selectedItemId }) {

  if (!item) {
    return null;
  }

  return (
    <div
      className="message-item-context"
      style={{
        alignItems: 'center',
        background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.98)} 0%, ${alpha(theme.colors.canvas, 0.92)} 100%)`,
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 22,
        boxShadow: '0 18px 34px rgba(24, 33, 46, 0.08)',
        display: 'grid',
        gap: 12,
        gridTemplateColumns: '72px minmax(0, 1fr)',
        justifySelf: 'start',
        maxWidth: 'min(100%, 460px)',
        padding: 12,
        width: '100%',
      }}
    >
      <div
        style={{
          background: item.primaryImage?.image_url
            ? `linear-gradient(180deg, rgba(13, 17, 25, 0.02), rgba(13, 17, 25, 0.24)), url(${item.primaryImage.image_url}) center/cover`
            : `linear-gradient(135deg, ${alpha(theme.colors.teal, 0.94)} 0%, ${alpha(theme.colors.sky, 0.78)} 100%)`,
          borderRadius: 18,
          minHeight: 72,
          overflow: 'hidden',
        }}
      />

      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span style={{ color: theme.colors.slate, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Listing reference
          </span>
          <strong
            style={{
              color: theme.colors.ink,
              fontSize: 16,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </strong>
          <span style={{ color: theme.colors.ink, fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
            {currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day
          </span>
        </div>

        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ color: theme.colors.slate, fontSize: 12, lineHeight: 1.35 }}>
            {linkedItemCount > 1 ? `${linkedItemCount} linked items in this chat.` : 'Your reply stays linked to this item.'}
          </span>
          <Button
            onClick={onOpenItem}
            style={{
              background: alpha(theme.colors.panel, 0.9),
              border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
              boxShadow: 'none',
              color: theme.colors.ink,
              minHeight: 34,
              padding: '0 14px',
            }}
            variant="secondary"
          >
            View
          </Button>
        </div>

        {items.length > 1 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Send next message about
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.map((candidate) => {
                const isActive = candidate.id === selectedItemId;

                return (
                  <button
                    key={candidate.id}
                    onClick={() => onSelectItem?.(candidate.id)}
                    style={{
                      background: isActive ? alpha(theme.colors.sky, 0.14) : alpha(theme.colors.panel, 0.86),
                      border: `1px solid ${isActive ? alpha(theme.colors.sky, 0.24) : alpha(theme.colors.ink, 0.08)}`,
                      borderRadius: theme.radius.pill,
                      color: isActive ? theme.colors.sky : theme.colors.ink,
                      cursor: 'pointer',
                      fontFamily: theme.fonts.body,
                      fontSize: 12,
                      fontWeight: 600,
                      minHeight: 32,
                      padding: '0 12px',
                    }}
                    type="button"
                  >
                    {candidate.title}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerActionButton({ children, label, ...rest }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      type="button"
      style={{
        alignItems: 'center',
        background: alpha(theme.colors.panel, 0.88),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: theme.radius.pill,
        color: theme.colors.slate,
        cursor: 'pointer',
        display: 'inline-flex',
        height: 36,
        justifyContent: 'center',
        minWidth: 40,
        padding: '0 10px',
      }}
    >
      {children}
    </button>
  );
}

function MessageBubble({ currentUserId, message, showItemReference }) {
  const isOwnMessage = message.sender_id === currentUserId;
  const senderName = buildPersonName(message.sender) || 'Community member';
  const senderInitials = buildInitials(message.sender);
  const hasAttachment = Boolean(message.attachment_url);
  const hasText = Boolean(String(message.message_text || '').trim());
  const referencedItem = message.item || null;

  return (
    <div
      style={{
        display: 'grid',
        justifyItems: isOwnMessage ? 'end' : 'start',
      }}
    >
      <div
        style={{
          alignItems: 'end',
          display: 'grid',
          gap: 8,
          gridTemplateColumns: isOwnMessage ? 'minmax(0, 1fr)' : '36px minmax(0, 1fr)',
          maxWidth: 'min(100%, 760px)',
          width: '100%',
        }}
      >
        {!isOwnMessage ? (
          <div
            style={{
              alignItems: 'center',
              background: alpha(theme.colors.sky, 0.12),
              borderRadius: '50%',
              color: theme.colors.sky,
              display: 'inline-flex',
              height: 36,
              justifyContent: 'center',
              overflow: 'hidden',
              width: 36,
            }}
          >
            {message.sender?.profile_photo_url ? (
              <img alt={senderName} src={message.sender.profile_photo_url} style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }} />
            ) : (
              <span style={{ fontSize: 12, fontWeight: 700 }}>{senderInitials}</span>
            )}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 8, justifyItems: isOwnMessage ? 'end' : 'start' }}>
          {showItemReference && referencedItem ? (
            <div
              className={`message-bubble${isOwnMessage ? ' own' : ''}`}
              style={{
                background: alpha(theme.colors.panel, 0.96),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 18,
                boxShadow: '0 14px 32px rgba(24, 33, 46, 0.08)',
                display: 'grid',
                gap: 10,
                gridTemplateColumns: '56px minmax(0, 1fr)',
                maxWidth: 'min(100%, 340px)',
                padding: 10,
              }}
            >
              <div
                style={{
                  background: referencedItem.primaryImage?.image_url
                    ? `linear-gradient(180deg, rgba(13, 17, 25, 0.02), rgba(13, 17, 25, 0.18)), url(${referencedItem.primaryImage.image_url}) center/cover`
                    : `linear-gradient(135deg, ${alpha(theme.colors.teal, 0.94)} 0%, ${alpha(theme.colors.sky, 0.78)} 100%)`,
                  borderRadius: 14,
                  minHeight: 56,
                }}
              />
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span style={{ color: theme.colors.slate, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Refers to
                </span>
                <strong style={{ color: theme.colors.ink, fontSize: 14, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {referencedItem.title}
                </strong>
                <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                  {currencyFormatter.format(Number(referencedItem.rental_price_per_day) || 0)} / day
                </span>
              </div>
            </div>
          ) : null}

          {hasAttachment && isImageAttachment(message.attachment_url) ? (
            <img
              alt="Message attachment"
              src={message.attachment_url}
              style={{
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 22,
                boxShadow: '0 18px 48px rgba(24, 33, 46, 0.1)',
                display: 'block',
                maxHeight: 320,
                maxWidth: 'min(100%, 340px)',
                objectFit: 'cover',
                width: '100%',
              }}
            />
          ) : null}

          {hasAttachment && !isImageAttachment(message.attachment_url) ? (
            <a
              href={message.attachment_url}
              rel="noreferrer"
              style={{
                alignItems: 'center',
                background: alpha(theme.colors.panel, 0.96),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 18,
                color: theme.colors.ink,
                display: 'inline-flex',
                fontSize: 14,
                fontWeight: 600,
                gap: 10,
                maxWidth: 'min(100%, 340px)',
                padding: '12px 14px',
                textDecoration: 'none',
              }}
              target="_blank"
            >
              <UploadIcon size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{buildAttachmentLabel(message.attachment_url)}</span>
            </a>
          ) : null}

          {hasText || (!hasAttachment && !hasText) ? (
            <div
              style={{
                background: isOwnMessage ? alpha(theme.colors.sky, 0.16) : alpha(theme.colors.panel, 0.94),
                border: `1px solid ${isOwnMessage ? alpha(theme.colors.sky, 0.2) : alpha(theme.colors.ink, 0.08)}`,
                borderRadius: isOwnMessage ? '22px 22px 8px 22px' : '22px 22px 22px 8px',
                boxShadow: '0 18px 40px rgba(24, 33, 46, 0.08)',
                color: theme.colors.ink,
                maxWidth: 'min(100%, 560px)',
                padding: '12px 16px',
              }}
            >
              <span style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{hasText ? message.message_text : 'No text content.'}</span>
            </div>
          ) : null}

          <span
            style={{
              color: theme.colors.slate,
              fontSize: 12,
              lineHeight: 1.3,
            }}
            title={formatDateTime(message.sent_at)}
          >
            {isOwnMessage ? `Sent ${formatThreadTime(message.sent_at)}` : formatThreadTime(message.sent_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Messages() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversation');
  const requestedBookingId = searchParams.get('booking');
  const requestedItemId = searchParams.get('item');
  const initialConversationIdRef = useRef(requestedConversationId);
  const initialBookingIdRef = useRef(requestedBookingId);
  const messageFeedRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(requestedItemId || '');
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState('');
  const [activeFaq, setActiveFaq] = useState(null);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadThreads() {
      setLoading(true);
      setError('');

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (!user) {
        setCurrentUser(null);
        setThreads([]);
        setLoading(false);
        setError('Sign in to view your conversations.');
        return;
      }

      setCurrentUser(user);

      const membershipResult = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);

      if (!mounted) {
        return;
      }

      if (membershipResult.error) {
        setThreads([]);
        setLoading(false);
        setError(`Unable to load your conversations: ${membershipResult.error.message}`);
        return;
      }

      const conversationIds = Array.from(new Set((membershipResult.data || []).map((entry) => entry.conversation_id).filter(Boolean)));

      if (!conversationIds.length) {
        setThreads([]);
        setLoading(false);
        return;
      }

      const [conversationMembersResult, conversationsResult, messagesResult] = await Promise.all([
        supabase.from('conversation_members').select('conversation_id, user_id, joined_at').in('conversation_id', conversationIds),
        supabase.from('conversations').select('id, booking_id, item_id, created_at').in('id', conversationIds),
        supabase
          .from('messages')
          .select('id, conversation_id, sender_id, message_type, message_text, attachment_url, sent_at, read_at')
          .in('conversation_id', conversationIds)
          .order('sent_at', { ascending: true }),
      ]);

      if (!mounted) {
        return;
      }

      const nextErrors = [];

      if (conversationMembersResult.error) {
        nextErrors.push(`members: ${conversationMembersResult.error.message}`);
      }

      if (conversationsResult.error) {
        nextErrors.push(`conversations: ${conversationsResult.error.message}`);
      }

      if (messagesResult.error) {
        nextErrors.push(`messages: ${messagesResult.error.message}`);
      }

      const conversationRows = conversationsResult.data || [];
      const bookingIds = Array.from(new Set(conversationRows.map((conversation) => conversation.booking_id).filter(Boolean)));
      const itemIds = Array.from(new Set(conversationRows.map((conversation) => conversation.item_id).filter(Boolean)));
      const participantIds = Array.from(
        new Set(
          [...(conversationMembersResult.data || []).map((entry) => entry.user_id), ...(messagesResult.data || []).map((message) => message.sender_id)].filter(Boolean)
        )
      );

      const [bookingsResult, meetupsResult, addonsResult, profilesResult, itemsResult, imagesResult, faqsResult] = await Promise.all([
        bookingIds.length
          ? supabase
              .from('bookings')
              .select(
                'id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, rental_days, rental_fee_total, security_deposit, total_due, borrower_message, status, created_at'
              )
              .in('id', bookingIds)
          : Promise.resolve({ data: [], error: null }),
        bookingIds.length
          ? supabase
              .from('booking_meetups')
              .select(
                'id, booking_id, meetup_type, scheduled_at, street, region, barangay, city, province, country, latitude, longitude, location_text, owner_confirmed, borrower_confirmed, status, notes'
              )
              .in('booking_id', bookingIds)
              .order('scheduled_at', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        bookingIds.length
          ? supabase
              .from('booking_addons')
              .select('id, booking_id, addon_name_snapshot, price_snapshot, pricing_type_snapshot, quantity, total_amount, created_at')
              .in('booking_id', bookingIds)
          : Promise.resolve({ data: [], error: null }),
        participantIds.length
          ? supabase
              .from('profiles')
              .select('id, first_name, middle_name, last_name, suffix, username, profile_photo_url, average_rating, total_reviews, is_verified')
              .in('id', participantIds)
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase
              .from('items')
              .select('id, owner_id, category_id, title, rental_price_per_day, security_deposit, status, created_at')
              .in('id', itemIds)
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase
              .from('item_images')
              .select('id, item_id, image_url, is_primary, sort_order')
              .in('item_id', itemIds)
              .order('sort_order', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase.from('item_faqs').select('id, item_id, question, answer, sort_order').in('item_id', itemIds).eq('is_active', true).order('sort_order', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!mounted) {
        return;
      }

      if (bookingsResult.error) {
        nextErrors.push(`bookings: ${bookingsResult.error.message}`);
      }

      if (meetupsResult.error) {
        nextErrors.push(`meetups: ${meetupsResult.error.message}`);
      }

      if (addonsResult.error) {
        nextErrors.push(`booking add-ons: ${addonsResult.error.message}`);
      }

      if (profilesResult.error) {
        nextErrors.push(`profiles: ${profilesResult.error.message}`);
      }

      if (itemsResult.error) {
        nextErrors.push(`items: ${itemsResult.error.message}`);
      }

      if (imagesResult.error) {
        nextErrors.push(`item images: ${imagesResult.error.message}`);
      }
      if (faqsResult.error) nextErrors.push(`listing FAQs: ${faqsResult.error.message}`);

      const bookingMap = new Map((bookingsResult.data || []).map((booking) => [booking.id, booking]));
      const itemMap = new Map((itemsResult.data || []).map((item) => [item.id, item]));
      const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const membersByConversation = new Map();
      const messagesByConversation = new Map();
      const meetupsByBooking = new Map();
      const addonsByBooking = new Map();
      const imagesByItem = new Map();
      const faqsByItem = new Map();

      (conversationMembersResult.data || []).forEach((entry) => {
        const current = membersByConversation.get(entry.conversation_id) || [];
        current.push(entry);
        membersByConversation.set(entry.conversation_id, current);
      });

      (messagesResult.data || []).forEach((message) => {
        const current = messagesByConversation.get(message.conversation_id) || [];
        current.push({ ...message, sender: profileMap.get(message.sender_id) || null });
        messagesByConversation.set(message.conversation_id, current);
      });

      (meetupsResult.data || []).forEach((meetup) => {
        const current = meetupsByBooking.get(meetup.booking_id) || [];
        current.push(meetup);
        meetupsByBooking.set(meetup.booking_id, current);
      });

      (addonsResult.data || []).forEach((addon) => {
        const current = addonsByBooking.get(addon.booking_id) || [];
        current.push(addon);
        addonsByBooking.set(addon.booking_id, current);
      });

      (imagesResult.data || []).forEach((image) => {
        const current = imagesByItem.get(image.item_id) || [];
        current.push(image);
        imagesByItem.set(image.item_id, current);
      });
      (faqsResult.data || []).forEach((faq) => {
        const current = faqsByItem.get(faq.item_id) || [];
        current.push(faq);
        faqsByItem.set(faq.item_id, current);
      });

      const rawThreads = conversationRows
        .map((conversation) => {
          const booking = conversation.booking_id ? bookingMap.get(conversation.booking_id) || null : null;
          const itemId = conversation.item_id || booking?.item_id || null;
          const itemImages = itemId ? (imagesByItem.get(itemId) || []).slice() : [];
          const sortedImages = itemImages.sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
          const rawItem = itemId ? itemMap.get(itemId) || null : null;
          const item = rawItem ? { ...rawItem, faqs: faqsByItem.get(itemId) || [] } : null;
          const members = (membersByConversation.get(conversation.id) || []).map((member) => ({
            ...member,
            profile: profileMap.get(member.user_id) || null,
          }));
          const otherParticipant = members.find((member) => member.user_id !== user.id)?.profile || null;
          const messages = (messagesByConversation.get(conversation.id) || []).slice();
          const lastMessage = messages[messages.length - 1] || null;
          const unreadCount = messages.filter((message) => message.sender_id !== user.id && !message.read_at).length;

          return {
            ...conversation,
            addOns: booking ? addonsByBooking.get(booking.id) || [] : [],
            booking: booking || null,
            item: item ? { ...item, primaryImage: sortedImages[0] || null } : null,
            lastMessage,
            members,
            messages,
            meetups: booking ? meetupsByBooking.get(booking.id) || [] : [],
            otherParticipant,
            unreadCount,
          };
        })
        .sort((left, right) => getThreadActivityTime(right) - getThreadActivityTime(left));

      const nextThreads = Array.from(
        rawThreads.reduce((groups, thread) => {
          const key = buildThreadKey(thread);
          const current = groups.get(key) || [];
          current.push(thread);
          groups.set(key, current);
          return groups;
        }, new Map()).values()
      )
        .map((group) => {
          const sortedGroup = group.slice().sort((left, right) => getThreadActivityTime(right) - getThreadActivityTime(left));
          const primaryThread = sortedGroup[0];
          const messages = sortedGroup
            .flatMap((thread) => thread.messages.map((message) => ({ ...message, item: thread.item || null })))
            .sort((left, right) => new Date(left.sent_at || 0).getTime() - new Date(right.sent_at || 0).getTime());
          const items = Array.from(
            new Map(
              sortedGroup
                .map((thread) => thread.item)
                .filter(Boolean)
                .map((item) => [item.id, item])
            ).values()
          );
          const defaultItem = primaryThread.item || items[0] || null;
          const bookingIds = sortedGroup.map((thread) => thread.booking?.id).filter(Boolean);
          const unreadCount = messages.filter((message) => message.sender_id !== user.id && !message.read_at).length;

          return {
            ...primaryThread,
            bookingIds,
            conversationIds: sortedGroup.map((thread) => thread.id),
            conversations: sortedGroup,
            item: defaultItem,
            itemSearchText: items.map((item) => item.title).filter(Boolean).join(' ').toLowerCase(),
            itemSummary:
              items.length > 1
                ? `${defaultItem?.title || 'Marketplace thread'} +${items.length - 1} more`
                : defaultItem?.title || 'Marketplace thread',
            items,
            lastMessage: messages[messages.length - 1] || primaryThread.lastMessage,
            members: primaryThread.members,
            messages,
            unreadCount,
          };
        })
        .sort((left, right) => getThreadActivityTime(right) - getThreadActivityTime(left));

      const defaultThread =
        nextThreads.find((thread) => thread.conversationIds?.includes(initialConversationIdRef.current)) ||
        nextThreads.find((thread) => thread.bookingIds?.includes(initialBookingIdRef.current)) ||
        nextThreads[0] ||
        null;

      setThreads(nextThreads);
      setSelectedConversationId((current) => (current && nextThreads.some((thread) => thread.id === current) ? current : defaultThread?.id || ''));
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadThreads();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredThreads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return threads;
    }

    return threads.filter((thread) => {
      const otherParticipantName = buildPersonName(thread.otherParticipant).toLowerCase();
      const username = String(thread.otherParticipant?.username || '').toLowerCase();
      const itemTitle = String(thread.itemSearchText || thread.item?.title || '').toLowerCase();
      const lastMessageText = String(thread.lastMessage?.message_text || '').toLowerCase();

      return [otherParticipantName, username, itemTitle, lastMessageText].some((value) => value.includes(normalizedSearch));
    });
  }, [search, threads]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedConversationId) || filteredThreads[0] || null,
    [filteredThreads, selectedConversationId, threads]
  );

  useEffect(() => {
    if (!threads.length) {
      return;
    }

    const requestedThread =
      threads.find((thread) => thread.conversationIds?.includes(requestedConversationId)) ||
      threads.find((thread) => thread.bookingIds?.includes(requestedBookingId)) ||
      null;

    if (requestedThread && requestedThread.id !== selectedConversationId) {
      setSelectedConversationId(requestedThread.id);
    }
  }, [requestedBookingId, requestedConversationId, selectedConversationId, threads]);

  useEffect(() => {
    if (!selectedThread || !currentUser) {
      return;
    }

    const unreadIds = selectedThread.messages.filter((message) => message.sender_id !== currentUser.id && !message.read_at).map((message) => message.id);

    if (!unreadIds.length) {
      return;
    }

    const readAt = new Date().toISOString();

    setThreads((current) =>
      current.map((thread) =>
        thread.id === selectedThread.id
          ? {
              ...thread,
              messages: thread.messages.map((message) => (unreadIds.includes(message.id) ? { ...message, read_at: readAt } : message)),
              unreadCount: 0,
            }
          : thread
      )
    );

    supabase.from('messages').update({ read_at: readAt }).in('id', unreadIds);
  }, [currentUser, selectedThread]);

  useEffect(() => {
    if (!selectedThread) {
      setSelectedItemId('');
      return;
    }

    const nextItems = selectedThread.items || [];
    const matchingRequestedItem = requestedItemId && nextItems.find((item) => item.id === requestedItemId);
    const matchingCurrentItem = selectedItemId && nextItems.find((item) => item.id === selectedItemId);
    const fallbackItem = matchingRequestedItem || matchingCurrentItem || selectedThread.item || nextItems[0] || null;
    const fallbackItemId = fallbackItem?.id || '';

    if (fallbackItemId !== selectedItemId) {
      setSelectedItemId(fallbackItemId);
    }
  }, [requestedItemId, selectedItemId, selectedThread]);

  useEffect(() => {
    if (!selectedThread) {
      return;
    }

    const feedNode = messageFeedRef.current;

    if (!feedNode) {
      return;
    }

    feedNode.scrollTop = feedNode.scrollHeight;
  }, [selectedThread]);

  async function uploadAttachment(file) {
    if (!file || !currentUser || !selectedThread) {
      return '';
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = `${currentUser.id}/messages/${selectedThread.id}/${Date.now()}-${safeName || `attachment.${fileExt}`}`;

    const { error: uploadError } = await supabase.storage.from(MESSAGE_ATTACHMENTS_BUCKET).upload(filePath, file, { upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from(MESSAGE_ATTACHMENTS_BUCKET).getPublicUrl(filePath);
    const publicUrl = data?.publicUrl || '';

    if (!publicUrl) {
      throw new Error('An uploaded attachment URL could not be resolved.');
    }

    return publicUrl;
  }

  async function ensureConversationForSelectedItem(item) {
    if (!selectedThread || !item || !currentUser) {
      return selectedThread;
    }

    const existingConversation = selectedThread.conversations?.find((conversation) => conversation.item?.id === item.id) || null;

    if (existingConversation) {
      return existingConversation;
    }

    const { data: conversationRow, error: createConversationError } = await supabase
      .from('conversations')
      .insert({ item_id: item.id })
      .select('id, booking_id, item_id, created_at')
      .single();

    if (createConversationError) {
      throw new Error(createConversationError.message);
    }

    const otherUserId = selectedThread.otherParticipant?.id || item.owner_id;
    const membersPayload = [
      { conversation_id: conversationRow.id, user_id: currentUser.id },
      { conversation_id: conversationRow.id, user_id: otherUserId },
    ].filter((entry) => entry.user_id);

    const { error: membersError } = await supabase.from('conversation_members').upsert(membersPayload, {
      ignoreDuplicates: true,
      onConflict: 'conversation_id,user_id',
    });

    if (membersError) {
      throw new Error(membersError.message);
    }

    return {
      ...conversationRow,
      addOns: [],
      booking: null,
      item,
      lastMessage: null,
      members: selectedThread.members,
      messages: [],
      meetups: [],
      otherParticipant: selectedThread.otherParticipant,
      unreadCount: 0,
    };
  }

  async function handleSendMessage(event) {
    event?.preventDefault();

    if (!selectedThread || !currentUser || sending) {
      return;
    }

    const nextMessageText = composer.trim();
    const nextAttachmentFile = attachmentFile;
    const targetItem = selectedThread.items?.find((item) => item.id === selectedItemId) || selectedThread.item || null;

    if ((!nextMessageText && !nextAttachmentFile) || !targetItem) {
      return;
    }

    setSending(true);

    let attachmentUrl = '';

    if (nextAttachmentFile) {
      try {
        attachmentUrl = await uploadAttachment(nextAttachmentFile);
      } catch (uploadError) {
        setError(`Unable to upload the attachment: ${uploadError.message}`);
        setSending(false);
        return;
      }
    }

    let activeConversation = null;

    try {
      activeConversation = await ensureConversationForSelectedItem(targetItem);
    } catch (conversationError) {
      setError(`Unable to prepare the listing reference: ${conversationError.message}`);
      setSending(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        attachment_url: attachmentUrl || null,
        conversation_id: activeConversation.id,
        message_text: nextMessageText || null,
        message_type: 'text',
        sender_id: currentUser.id,
      })
      .select('id, conversation_id, sender_id, message_type, message_text, attachment_url, sent_at, read_at')
      .single();

    if (insertError) {
      setError(`Unable to send the message: ${insertError.message}`);
      setSending(false);
      return;
    }

    const senderProfile = selectedThread.members.find((member) => member.user_id === currentUser.id)?.profile || null;
    const nextMessage = { ...data, item: targetItem, sender: senderProfile };

    setThreads((current) =>
      current
        .map((thread) =>
          thread.id === selectedThread.id
            ? (() => {
                const nextItems = (thread.items || []).some((item) => item.id === targetItem.id) ? thread.items : [targetItem, ...(thread.items || [])];

                return {
                  ...thread,
                  conversationIds: thread.conversationIds.includes(activeConversation.id) ? thread.conversationIds : [...thread.conversationIds, activeConversation.id],
                  conversations: thread.conversations.some((conversation) => conversation.id === activeConversation.id)
                    ? thread.conversations.map((conversation) =>
                        conversation.id === activeConversation.id
                          ? {
                              ...conversation,
                              lastMessage: nextMessage,
                              messages: [...conversation.messages, nextMessage],
                            }
                          : conversation
                      )
                    : [
                        {
                          ...activeConversation,
                          lastMessage: nextMessage,
                          messages: [nextMessage],
                        },
                        ...thread.conversations,
                      ],
                  item: targetItem,
                  itemSearchText: Array.from(new Set([...nextItems.map((item) => item.title).filter(Boolean)])).join(' ').toLowerCase(),
                  itemSummary: nextItems.length > 1 ? `${targetItem.title} +${nextItems.length - 1} more` : targetItem.title,
                  items: nextItems,
                  lastMessage: nextMessage,
                  messages: [...thread.messages, nextMessage].sort((left, right) => new Date(left.sent_at || 0).getTime() - new Date(right.sent_at || 0).getTime()),
                };
              })()
            : thread
        )
        .sort((left, right) => {
          const leftDate = new Date(left.lastMessage?.sent_at || left.created_at || 0).getTime();
          const rightDate = new Date(right.lastMessage?.sent_at || right.created_at || 0).getTime();
          return rightDate - leftDate;
        })
    );

    setComposer('');
    setAttachmentFile(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
    setSending(false);
  }

  function handleSelectConversation(conversationId) {
    const nextThread = threads.find((thread) => thread.id === conversationId) || null;
    setSelectedConversationId(conversationId);
    setSearchParams({
      conversation: conversationId,
      ...(nextThread?.item?.id ? { item: nextThread.item.id } : {}),
    });
  }

  function handleSelectThreadItem(itemId) {
    setSelectedItemId(itemId);
    setActiveFaq(null);

    if (!selectedThread) {
      return;
    }

    setSearchParams({
      conversation: selectedThread.id,
      item: itemId,
    });
  }

  function handlePickAttachment() {
    attachmentInputRef.current?.click();
  }

  function handleAttachmentChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setAttachmentFile(nextFile);
  }

  function handleClearAttachment() {
    setAttachmentFile(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSendMessage();
  }

  const selectedParticipantName = buildPersonName(selectedThread?.otherParticipant) || 'Community member';
  const selectedParticipantInitials = buildInitials(selectedThread?.otherParticipant);
  const selectedParticipantHandle = selectedThread?.otherParticipant?.username ? `@${selectedThread.otherParticipant.username}` : 'Marketplace chat';
  const selectedThreadStatus = selectedThread?.booking ? formatLabel(selectedThread.booking.status, 'Pending') : 'Seller can be contacted anytime';
  const selectedParticipantNameSize = getAdaptiveNameSize(selectedParticipantName, 24, 22, 20);
  const selectedThreadItem =
    (selectedItemId ? selectedThread?.items?.find((item) => item.id === selectedItemId) : null) ||
    selectedThread?.item ||
    null;
  const selectedThreadWallpaper = selectedThreadItem?.primaryImage?.image_url
    ? `linear-gradient(180deg, rgba(255, 253, 248, 0.94) 0%, rgba(255, 253, 248, 0.98) 100%), radial-gradient(circle at top right, ${alpha(theme.colors.sky, 0.12)}, transparent 28%), radial-gradient(circle at bottom left, ${alpha(theme.colors.teal, 0.1)}, transparent 26%), url(${selectedThreadItem.primaryImage.image_url}) center/cover`
    : `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.98)} 0%, ${alpha(theme.colors.canvas, 0.94)} 100%), radial-gradient(circle at top right, ${alpha(theme.colors.sky, 0.12)}, transparent 28%), radial-gradient(circle at bottom left, ${alpha(theme.colors.teal, 0.1)}, transparent 26%)`;
  const selectedItemFaqs = selectedThreadItem?.faqs || [];

  if (loading) {
    return (
      <UserShell subtitle="" title="">
        <div className="messages-loading-state">
          <DataLoadingScreen
            label="Loading conversations"
            message="Loading your chats from the database."
            title="Getting conversations"
          />
        </div>
      </UserShell>
    );
  }

  return (
    <UserShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <div
        className="two-column messages-shell"
        style={{
          background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.98)} 0%, ${alpha(theme.colors.canvas, 0.92)} 100%)`,
          border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
          boxShadow: theme.shadows.panel,
          display: 'grid',
          gap: 0,
          gridTemplateColumns: 'minmax(320px, 360px) minmax(0, 1fr)',
          height: chatViewportHeight,
          maxHeight: chatViewportHeight,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <aside
          className="messages-sidebar"
          style={{
            background: `linear-gradient(180deg, ${alpha(theme.colors.canvas, 0.86)} 0%, ${alpha(theme.colors.panel, 0.96)} 100%)`,
            borderRight: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
            display: 'grid',
            gridTemplateRows: 'auto auto auto 1fr',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'grid', gap: 16, padding: 22 }}>
            <div style={{ alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <h2
                  style={{
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.display,
                    fontSize: 34,
                    letterSpacing: '-0.06em',
                    lineHeight: 0.95,
                    margin: 0,
                  }}
                >
                  Chats
                </h2>
                <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.4 }}>
                  Seller chats are grouped per member pair, while the current listing stays attached near the message box.
                </span>
              </div>
            </div>
          </div>

          <div style={{ padding: '0 20px 14px' }}>
            <div
              className="messages-search"
              style={{
                alignItems: 'center',
                background: alpha(theme.colors.panel, 0.94),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: theme.radius.pill,
                display: 'grid',
                gap: 12,
                gridTemplateColumns: '20px minmax(0, 1fr)',
                minHeight: 48,
                padding: '0 16px',
              }}
            >
              <span style={{ color: theme.colors.slate, display: 'inline-flex' }}>
                <SearchIcon size={17} />
              </span>
              <input
                name="conversation_search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search seller, item, or message"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.body,
                  fontSize: 15,
                  minWidth: 0,
                  outline: 'none',
                  width: '100%',
                }}
                value={search}
              />
            </div>
          </div>

          <div style={{ alignItems: 'center', display: 'flex', gap: 8, padding: '0 20px 14px' }}>
            <span
              style={{
                background: alpha(theme.colors.panel, 0.84),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: theme.radius.pill,
                color: theme.colors.sky,
                display: 'inline-flex',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                minHeight: 28,
                padding: '0 12px',
                textTransform: 'uppercase',
              }}
            >
              {filteredThreads.length} thread{filteredThreads.length === 1 ? '' : 's'}
            </span>
          </div>

          <div style={{ alignContent: 'start', display: 'grid', gap: 6, minHeight: 0, overflowY: 'auto', padding: '0 14px 14px' }}>
            {!loading && filteredThreads.length ? (
              filteredThreads.map((thread) => (
                <ThreadListItem
                  active={thread.id === selectedThread?.id}
                  key={thread.id}
                  onSelect={() => handleSelectConversation(thread.id)}
                  thread={thread}
                />
              ))
            ) : null}

            {!loading && !filteredThreads.length ? (
              <div
                className="messages-empty-card"
                style={{
                  alignContent: 'center',
                  background: alpha(theme.colors.panel, 0.9),
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 24,
                  color: theme.colors.ink,
                  display: 'grid',
                  gap: 10,
                  justifyItems: 'start',
                  margin: '0 8px',
                  minHeight: 220,
                  padding: 20,
                }}
              >
                <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 22, letterSpacing: '-0.04em', margin: 0 }}>
                  No conversations yet
                </strong>
                <span style={{ color: theme.colors.slate, lineHeight: 1.7 }}>
                  Open a listing and tap chat to start a seller thread. Conversations are grouped per seller and renter pair, while the current listing stays attached near the message box.
                </span>
              </div>
            ) : null}
          </div>
        </aside>

        <section
          className="messages-conversation"
          style={{
            background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.94)} 0%, ${alpha(theme.colors.canvas, 0.9)} 100%)`,
            display: 'grid',
            gridTemplateRows: selectedThread ? 'auto 1fr auto' : '1fr',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {selectedThread ? (
            <>
              <div
                className="messages-conversation-header"
                style={{
                  alignItems: 'center',
                  background: alpha(theme.colors.panel, 0.94),
                  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  display: 'flex',
                  gap: 14,
                  justifyContent: 'space-between',
                  padding: '18px 22px',
                }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 14, minWidth: 0 }}>
                  <div
                    style={{
                      alignItems: 'center',
                      background: alpha(theme.colors.sky, 0.12),
                      borderRadius: '50%',
                      color: theme.colors.sky,
                      display: 'inline-flex',
                      flexShrink: 0,
                      height: 54,
                      justifyContent: 'center',
                      overflow: 'hidden',
                      width: 54,
                    }}
                  >
                    {selectedThread.otherParticipant?.profile_photo_url ? (
                      <img
                        alt={selectedParticipantName}
                        src={selectedThread.otherParticipant.profile_photo_url}
                        style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }}
                      />
                    ) : (
                      <span style={{ fontSize: 18, fontWeight: 700 }}>{selectedParticipantInitials}</span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <strong
                        style={{
                          color: theme.colors.ink,
                          fontFamily: theme.fonts.display,
                          fontSize: selectedParticipantNameSize,
                          letterSpacing: '-0.04em',
                          lineHeight: 1.06,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {selectedParticipantName}
                      </strong>
                    </div>
                    <span style={{ color: theme.colors.slate, fontSize: 14 }}>
                      {selectedParticipantHandle} | {selectedThreadStatus}
                    </span>
                    <StarRating
                      rating={selectedThread.otherParticipant?.average_rating}
                      reviewCount={selectedThread.otherParticipant?.total_reviews}
                      textStyle={{ color: theme.colors.slate, fontSize: 12 }}
                    />
                  </div>
                </div>

              </div>

              <div
                className="messages-feed"
                ref={messageFeedRef}
                style={{
                  background: selectedThreadWallpaper,
                  display: 'grid',
                  gap: 14,
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '18px 20px 22px',
                }}
              >
                {selectedItemFaqs.length ? (
                  <section className="faq-assistant-card">
                    <div className="faq-assistant-head"><span>?</span><div><strong>Quick questions</strong><small>Choose a question to chat with the seller's FAQ assistant</small></div></div>
                    <div className="faq-assistant-prompts">
                      {selectedItemFaqs.map((faq) => <button className={activeFaq?.id === faq.id ? 'active' : ''} key={faq.id} onClick={() => setActiveFaq(faq)} type="button">{faq.question}</button>)}
                    </div>
                  </section>
                ) : null}
                {activeFaq ? <div className="faq-chat-exchange"><div className="faq-chat-question">{activeFaq.question}</div><div className="faq-chat-answer"><span className="faq-chat-avatar">?</span><div><strong>Seller FAQ assistant</strong><p>{activeFaq.answer}</p><small>Answer provided by the lender for {selectedThreadItem?.title}</small></div></div></div> : null}
                {selectedThread.messages.map((message, index) => {
                    const previousMessage = index > 0 ? selectedThread.messages[index - 1] : null;
                    const showItemReference =
                      (selectedThread.items?.length || 0) > 1 && Boolean(message.item?.id) && previousMessage?.item?.id !== message.item?.id;

                    return (
                      <MessageBubble
                        currentUserId={currentUser?.id}
                        key={message.id}
                        message={message}
                        showItemReference={showItemReference}
                      />
                    );
                  })}
              </div>

              <form
                className="messages-composer-area"
                onSubmit={handleSendMessage}
                style={{
                  background: alpha(theme.colors.panel, 0.96),
                  borderTop: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  display: 'grid',
                  gap: 12,
                  padding: 18,
                }}
              >
                <input
                  ref={attachmentInputRef}
                  onChange={handleAttachmentChange}
                  style={{ display: 'none' }}
                  type="file"
                />

                <ItemContextCard
                  item={selectedThreadItem}
                  items={selectedThread?.items || []}
                  linkedItemCount={selectedThread?.items?.length || 0}
                  onOpenItem={() => (selectedThreadItem ? navigate(`/user/view-item-list/${selectedThreadItem.id}`) : null)}
                  onSelectItem={handleSelectThreadItem}
                  selectedItemId={selectedItemId}
                />

                {attachmentFile ? (
                  <div
                    style={{
                      alignItems: 'center',
                      background: alpha(theme.colors.panel, 0.88),
                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                      borderRadius: 18,
                      color: theme.colors.ink,
                      display: 'flex',
                      gap: 12,
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ alignItems: 'center', display: 'flex', gap: 10, minWidth: 0 }}>
                      <span style={{ color: theme.colors.sky, display: 'inline-flex' }}>
                        <UploadIcon size={16} />
                      </span>
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <strong
                          style={{
                            fontSize: 13,
                            lineHeight: 1.35,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {attachmentFile.name}
                        </strong>
                        <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                          {(attachmentFile.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleClearAttachment}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: theme.colors.slate,
                        cursor: 'pointer',
                        fontFamily: theme.fonts.body,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}

                <div
                  className="messages-composer"
                  style={{
                    alignItems: 'center',
                    background: alpha(theme.colors.canvas, 0.72),
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 30,
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <ComposerActionButton label="Attach file" onClick={handlePickAttachment}>
                      <UploadIcon size={18} />
                    </ComposerActionButton>
                  </div>

                  <div
                    style={{
                      alignItems: 'center',
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <textarea
                      onChange={(event) => setComposer(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      placeholder={`Message ${selectedParticipantName} about ${selectedThreadItem?.title || 'this item'}`}
                      rows={1}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: theme.colors.ink,
                        fontFamily: theme.fonts.body,
                        fontSize: 15,
                        lineHeight: 1.5,
                        maxHeight: 120,
                        minHeight: 28,
                        outline: 'none',
                        overflowY: 'auto',
                        padding: '8px 2px',
                        resize: 'none',
                      }}
                      value={composer}
                    />
                  </div>

                  <button
                    className="messages-send-button"
                    disabled={sending || (!composer.trim() && !attachmentFile)}
                    style={{
                      alignItems: 'center',
                      background: sending || (!composer.trim() && !attachmentFile) ? alpha(theme.colors.ink, 0.08) : theme.colors.ink,
                      border: 'none',
                      borderRadius: '50%',
                      color: '#ffffff',
                      cursor: sending || (!composer.trim() && !attachmentFile) ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      height: 42,
                      justifyContent: 'center',
                      width: 42,
                    }}
                    type="submit"
                  >
                    <ArrowRightIcon size={16} stroke={sending || (!composer.trim() && !attachmentFile) ? alpha(theme.colors.ink, 0.32) : '#ffffff'} />
                  </button>
                </div>

                <div style={{ alignItems: 'center', color: theme.colors.slate, display: 'flex', flexWrap: 'wrap', fontSize: 12, gap: 8, lineHeight: 1.5 }}>
                  <span>{selectedThreadItem?.title || 'Marketplace thread'}</span>
                  <span style={{ opacity: 0.5 }}>|</span>
                  <span>
                    {selectedThread.booking
                      ? 'Booking linked'
                      : selectedThread?.items?.length > 1
                        ? `Replies in this chat can reference any of the ${selectedThread.items.length} linked listings`
                        : 'Replies in this chat stay linked to the selected listing'}
                  </span>
                </div>
              </form>
            </>
          ) : (
            <div
              className="messages-empty-state"
              style={{
                alignContent: 'center',
                background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.96)} 0%, ${alpha(theme.colors.canvas, 0.92)} 100%)`,
                display: 'grid',
                gap: 12,
                justifyItems: 'center',
                padding: 30,
                textAlign: 'center',
              }}
            >
              <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 30, letterSpacing: '-0.05em' }}>
                Open a conversation
              </strong>
              <span style={{ color: theme.colors.slate, lineHeight: 1.75, maxWidth: 520 }}>
                Choose a seller thread on the left. Each conversation is grouped by member pair, and the compact item reference above the message box shows which listing is currently being discussed.
              </span>
            </div>
          )}
        </section>
      </div>
    </UserShell>
  );
}
