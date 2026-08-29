import { Button, Modal, StatusMessage } from '../ui/primitives';
import './TermsModal.css';

function formatPublishedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' }).format(date);
}

function isHeading(line) {
  const value = String(line || '').trim();
  return value.length <= 100 && (
    /^[A-Z][.)]\s+/.test(value)
    || /^\d+(?:\.\d+)*[.)]?\s+/.test(value)
    || /^[A-Z0-9][A-Z0-9 &,.'’/()-]{3,}$/.test(value)
    || (!/[.!?;:]$/.test(value) && value.split(/\s+/).length <= 8 && /^[A-Z][A-Za-z &'’/()-]+$/.test(value))
  );
}

export function TermsText({ text }) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const blocks = [];

  lines.forEach((line) => {
    if (isHeading(line)) {
      blocks.push({ text: line, type: 'heading' });
      return;
    }

    const bullet = line.match(/^[•●▪‣-]\s*(.+)$/);
    if (bullet) {
      blocks.push({ text: bullet[1], type: 'bullet' });
      return;
    }

    const previous = blocks[blocks.length - 1];
    if (previous?.type === 'paragraph') {
      previous.text = `${previous.text} ${line}`;
    } else {
      blocks.push({ text: line, type: 'paragraph' });
    }
  });

  return (
    <article className="terms-reader-copy">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={`${index}-${block.text}`}>{block.text}</h3>;
        if (block.type === 'bullet') {
          return <p className="terms-reader-bullet" key={`${index}-${block.text}`}><span aria-hidden="true">•</span><span>{block.text}</span></p>;
        }
        return <p key={`${index}-${block.text}`}>{block.text}</p>;
      })}
    </article>
  );
}

export default function TermsModal({ document, error = '', loading = false, onClose, open, title = 'Terms and Conditions' }) {
  return (
    <Modal
      actions={<Button className="terms-reader-close" onClick={onClose} type="button" variant="secondary">Done</Button>}
      contentClassName="terms-reader-modal"
      onClose={onClose}
      open={open}
      title={title}
    >
      {loading ? <StatusMessage tone="info">Loading the current Terms and Conditions...</StatusMessage> : null}
      {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
      {!loading && !error && document ? (
        <div className="terms-reader">
          <header className="terms-reader-header">
            <div>
              <span>Current policy</span>
              <h2>{document.title}</h2>
            </div>
            <div className="terms-reader-version">
              <strong>Version {document.version}</strong>
              <span>{formatPublishedDate(document.published_at)}</span>
            </div>
          </header>
          <TermsText text={document.extracted_text} />
        </div>
      ) : null}
      {!loading && !error && !document ? <StatusMessage tone="warning">No Terms and Conditions have been published yet.</StatusMessage> : null}
    </Modal>
  );
}
