import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TermsModal from '../../components/TermsModal';
import { supabase } from '../../api/supabaseClient';
import { extractTermsTextFromPdf, hashFile, safeTermsStoragePath, TERMS_BUCKET } from '../../services/termsService';
import { Badge, Button, Input, StatusMessage } from '../../ui/primitives';
import { ReportIcon, UploadIcon } from '../../ui/icons';
import AdminShell from './AdminShell';
import './TermsManagement.css';

const TERMS_FIELDS = 'id, title, version, file_name, storage_path, extracted_text, content_hash, is_active, published_at, created_at';

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function TermsManagement() {
  const fileInputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [title, setTitle] = useState('Borrow Ko To Terms and Conditions');
  const [selectedFile, setSelectedFile] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [previewDocument, setPreviewDocument] = useState(null);

  const currentDocument = useMemo(() => documents.find((document) => document.is_active) || null, [documents]);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('terms_documents').select(TERMS_FIELDS).order('version', { ascending: false });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setMessageTone('danger');
      return;
    }
    setDocuments(data || []);
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setExtraction(null);
    setMessage('');
    if (!file) return;

    setExtracting(true);
    try {
      const [result, contentHash] = await Promise.all([extractTermsTextFromPdf(file), hashFile(file)]);
      setExtraction({ ...result, contentHash });
      setMessage(`Text extracted successfully from ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}. Review it before publishing.`);
      setMessageTone('success');
    } catch (error) {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(error.message || 'Unable to extract text from this PDF.');
      setMessageTone('danger');
    } finally {
      setExtracting(false);
    }
  }

  async function publishDocument(event) {
    event.preventDefault();
    if (!selectedFile || !extraction?.text) {
      setMessage('Choose a readable PDF and wait for text extraction to finish.');
      setMessageTone('warning');
      return;
    }
    if (title.trim().length < 3) {
      setMessage('Enter a document title.');
      setMessageTone('warning');
      return;
    }

    setPublishing(true);
    setMessage('');
    const storagePath = safeTermsStoragePath(selectedFile.name);
    let uploaded = false;

    try {
      const uploadResult = await supabase.storage.from(TERMS_BUCKET).upload(storagePath, selectedFile, {
        cacheControl: '3600',
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploadResult.error) throw uploadResult.error;
      uploaded = true;

      const { error } = await supabase.rpc('publish_terms_document', {
        requested_content_hash: extraction.contentHash || null,
        requested_extracted_text: extraction.text,
        requested_file_name: selectedFile.name,
        requested_storage_path: storagePath,
        requested_title: title.trim(),
      });
      if (error) throw error;

      setSelectedFile(null);
      setExtraction(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage('The new Terms and Conditions version is now active for account activation and rental checkout.');
      setMessageTone('success');
      await loadDocuments();
    } catch (error) {
      if (uploaded) await supabase.storage.from(TERMS_BUCKET).remove([storagePath]);
      setMessage(error.message || 'Unable to publish the Terms and Conditions.');
      setMessageTone('danger');
    } finally {
      setPublishing(false);
    }
  }

  function previewPendingText() {
    if (!extraction?.text) return;
    setPreviewDocument({
      extracted_text: extraction.text,
      published_at: new Date().toISOString(),
      title: title.trim() || 'Terms and Conditions preview',
      version: (currentDocument?.version || 0) + 1,
    });
  }

  async function openPdf(document) {
    if (!document?.storage_path || document.storage_path.startsWith('bundled/')) return;
    const { data, error } = await supabase.storage.from(TERMS_BUCKET).createSignedUrl(document.storage_path, 120);
    if (error || !data?.signedUrl) {
      setMessage(error?.message || 'Unable to open this PDF.');
      setMessageTone('danger');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <AdminShell subtitle="Publish the policy students must accept during activation and before rental payment." title="Terms and Conditions">
      <main className="terms-admin-page">
        {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

        <section className="terms-admin-current">
          <div className="terms-admin-section-heading">
            <div><span>Active document</span><h2>{currentDocument?.title || 'No policy published'}</h2><p>{currentDocument ? `Version ${currentDocument.version} · Published ${formatDate(currentDocument.published_at)}` : 'Upload a PDF to enable student acceptance.'}</p></div>
            {currentDocument ? <Button onClick={() => setPreviewDocument(currentDocument)} variant="secondary">View student version</Button> : null}
          </div>
          <div className="terms-admin-rule-grid">
            <article><strong>Account activation</strong><span>New students must open and accept the current version before setting up their account.</span></article>
            <article><strong>Rental checkout</strong><span>Borrowers must accept the active version before the PayMongo checkout is created.</span></article>
            <article><strong>Audit history</strong><span>Every acceptance stores the student, policy version, context, and timestamp.</span></article>
          </div>
        </section>

        <section className="terms-admin-upload">
          <div className="terms-admin-section-heading"><div><span>Publish a new version</span><h2>Upload policy PDF</h2><p>The system extracts readable text from the PDF and presents it in an accessible student modal.</p></div></div>
          <form onSubmit={publishDocument}>
            <label className="terms-admin-title-field"><span>Document title</span><Input onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
            <label className={`terms-admin-file-picker ${selectedFile ? 'has-file' : ''}`}>
              <span className="terms-admin-file-icon"><UploadIcon size={22} /></span>
              <span><strong>{selectedFile?.name || 'Choose a Terms and Conditions PDF'}</strong><small>{extracting ? 'Extracting text...' : extraction ? `${extraction.pageCount} pages · ${extraction.text.length.toLocaleString()} characters extracted` : 'PDF only · Maximum 10 MB · Text-based documents work best'}</small></span>
              <em>Browse</em>
              <input accept="application/pdf,.pdf" disabled={extracting || publishing} onChange={handleFileChange} ref={fileInputRef} type="file" />
            </label>
            <div className="terms-admin-upload-actions">
              <Button disabled={!extraction || extracting || publishing} onClick={previewPendingText} type="button" variant="secondary">Preview extracted text</Button>
              <Button disabled={!extraction || extracting || publishing} type="submit">{publishing ? 'Publishing...' : 'Publish as current terms'}</Button>
            </div>
          </form>
        </section>

        <section className="terms-admin-history">
          <div className="terms-admin-section-heading"><div><span>Document history</span><h2>Published versions</h2><p>Older versions remain available for acceptance audit records.</p></div></div>
          <div className="terms-admin-table-wrap">
            <table>
              <thead><tr><th>Version</th><th>Document</th><th>Published</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="5" className="terms-admin-empty">Loading documents...</td></tr> : null}
                {!loading && !documents.length ? <tr><td colSpan="5" className="terms-admin-empty">No Terms and Conditions have been published.</td></tr> : null}
                {!loading && documents.map((document) => (
                  <tr key={document.id}>
                    <td><strong>v{document.version}</strong></td>
                    <td><div className="terms-admin-document-name"><ReportIcon size={18} /><span><strong>{document.title}</strong><small>{document.file_name}</small></span></div></td>
                    <td>{formatDate(document.published_at)}</td>
                    <td><Badge tone={document.is_active ? 'success' : 'neutral'}>{document.is_active ? 'Current' : 'Archived'}</Badge></td>
                    <td><div className="terms-admin-row-actions"><Button onClick={() => setPreviewDocument(document)} variant="secondary">View text</Button>{!document.storage_path.startsWith('bundled/') ? <Button onClick={() => openPdf(document)} variant="ghost">Open PDF</Button> : null}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <TermsModal document={previewDocument} onClose={() => setPreviewDocument(null)} open={Boolean(previewDocument)} title="Terms and Conditions preview" />
      </main>
    </AdminShell>
  );
}

