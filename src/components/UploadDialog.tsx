import { FileCheck2, HardDrive, LockKeyhole, Sparkles, UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_PDF_BYTES } from '../lib/api';
import { Modal, formatBytes } from './Primitives';

function validatePdf(file: File) {
  if (file.type !== 'application/pdf' && !file.name.toLocaleLowerCase().endsWith('.pdf')) return 'Choose a PDF file.';
  if (!file.size) return 'That PDF is empty.';
  if (file.size > MAX_PDF_BYTES) return 'Choose a PDF smaller than 50 MB.';
  return undefined;
}

export function UploadDialog({ open, mode = 'add', paperTitle, busy = false, onClose, onFile }: {
  open: boolean;
  mode?: 'add' | 'reattach';
  paperTitle?: string;
  busy?: boolean;
  onClose: () => void;
  onFile: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  function resetSelection() {
    setSelected(undefined);
    setError(undefined);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  useEffect(() => {
    resetSelection();
  }, [open]);

  function choose(file?: File) {
    if (!file) return;
    const nextError = validatePdf(file);
    setError(nextError);
    setSelected(nextError ? undefined : file);
  }

  function resetAndClose() {
    if (busy) return;
    resetSelection();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title={mode === 'reattach' ? 'Reattach the local PDF' : 'Add a research paper'}
      description={mode === 'reattach' ? `Choose the original file for “${paperTitle ?? 'this paper'}.” Sift will reconnect it on this device.` : 'Bring in the complete paper. Sift keeps the original file on this device.'}
      width="medium"
      footer={<>
        <button type="button" className="button button--ghost" onClick={resetAndClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="button button--primary"
          disabled={!selected || busy}
          onClick={() => selected && void onFile(selected)}
        >
          {busy ? <span className="button-spinner" /> : mode === 'reattach' ? <FileCheck2 /> : <UploadCloud />}
          {busy ? 'Saving PDF…' : mode === 'reattach' ? 'Reconnect PDF' : 'Add to Sift'}
        </button>
      </>}
    >
      <button
        type="button"
        className={`drop-zone${dragging ? ' is-dragging' : ''}${selected ? ' has-file' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        <input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => choose(event.target.files?.[0])} />
        <span className="drop-zone__icon">{selected ? <FileCheck2 /> : <UploadCloud />}</span>
        {selected ? <>
          <strong>{selected.name}</strong>
          <span>{formatBytes(selected.size)} · ready to save locally</span>
          <small>Choose a different PDF</small>
        </> : <>
          <strong>Drop a PDF here</strong>
          <span>or tap to choose from Files</span>
          <small>PDF only · up to 50 MB</small>
        </>}
      </button>
      {error && <div className="field-error" role="alert">{error}</div>}

      <div className="privacy-grid">
        <div><span><HardDrive /></span><strong>Library copy is local</strong><p>Your library copy stays in this browser on this device.</p></div>
        <div><span><LockKeyhole /></span><strong>Private sync</strong><p>Paper details, analysis, and notes sync only to your signed-in account.</p></div>
        <div><span><Sparkles /></span><strong>AI is opt-in</strong><p>Analyze paper securely sends the PDF to the AI service; opening and reading it does not.</p></div>
      </div>
    </Modal>
  );
}
