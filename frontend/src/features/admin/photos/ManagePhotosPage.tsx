import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import {
  getAdminActivity,
  patchAdminActivity,
  uploadAdminActivityPhoto,
  type AdminActivityPhoto,
  type PatchAdminActivityPayload,
} from '../../../api/adminActivities';
import { PhotoTile, type PhotoTileStatus } from './PhotoTile';
import './Photos.css';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

interface ExistingPhoto {
  kind: 'existing';
  url: string;
  thumb_url?: string;
  caption: string;
}

interface PendingPhoto {
  kind: 'pending';
  file: File;
  previewUrl: string;
  caption: string;
  status: PhotoTileStatus;
  errorMessage?: string;
  /** Set once this file's bytes are durably uploaded — lets a retry skip
   * re-uploading a file that already succeeded before a later one failed. */
  uploaded?: { url: string; thumb_url: string };
}

type StagedPhoto = ExistingPhoto | PendingPhoto;

function photoKey(p: StagedPhoto): string {
  return p.kind === 'existing' ? p.url : p.previewUrl;
}

function toExisting(photos: AdminActivityPhoto[]): ExistingPhoto[] {
  return photos.map((p) => ({
    kind: 'existing',
    url: p.url,
    thumb_url: p.thumb_url,
    caption: p.caption ?? '',
  }));
}

/** True once the staged array diverges from the loaded baseline — order,
 * captions, removals, and any pending (unsaved) file all count. */
function isDirty(current: StagedPhoto[], baseline: ExistingPhoto[]): boolean {
  if (current.length !== baseline.length) return true;
  return current.some(
    (p, i) =>
      p.kind !== 'existing' ||
      p.url !== baseline[i].url ||
      p.caption !== baseline[i].caption,
  );
}

function validateFile(file: File): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `"${file.name}" isn't a JPG or PNG file`;
  }
  if (file.size > MAX_BYTES) {
    return `"${file.name}" is over 8 MB`;
  }
  return undefined;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'load-error'; message: string };

/** Admin "Manage photos" page (design §7c) — add/remove/reorder/caption an
 * activity's gallery and set the cover, staged locally and written on Save
 * gallery only (upload-on-save: dropped files preview via an object URL and
 * are never uploaded on drop). */
export function ManagePhotosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [activityTitle, setActivityTitle] = useState('');
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const baselineRef = useRef<ExistingPhoto[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadState({ kind: 'loading' });
    getAdminActivity(id).then((res) => {
      if (cancelled) return;
      if (res.status === 'success') {
        setActivityTitle(res.data.title);
        const existing = toExisting(res.data.photos);
        baselineRef.current = existing;
        setPhotos(existing);
        setLoadState({ kind: 'loaded' });
      } else if (res.status === 404) {
        setLoadState({ kind: 'not-found' });
      } else if (res.status === 403) {
        setLoadState({ kind: 'forbidden' });
      } else {
        setLoadState({ kind: 'load-error', message: res.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const [rejectMessage, setRejectMessage] = useState<string>();
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pickedUpIndex, setPickedUpIndex] = useState<number | null>(null);
  const pickupSnapshotRef = useRef<StagedPhoto[] | null>(null);
  const dragFromIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saveForbidden, setSaveForbidden] = useState(false);

  function addFiles(fileList: FileList | File[]) {
    const rejects: string[] = [];
    const accepted: PendingPhoto[] = [];
    for (const file of Array.from(fileList)) {
      const err = validateFile(file);
      if (err) {
        rejects.push(err);
        continue;
      }
      accepted.push({
        kind: 'pending',
        file,
        previewUrl: URL.createObjectURL(file),
        caption: '',
        status: 'idle',
      });
    }
    setRejectMessage(rejects.length > 0 ? rejects.join('; ') : undefined);
    if (accepted.length > 0) setPhotos((prev) => [...prev, ...accepted]);
  }

  function reorder(from: number, to: number) {
    if (to < 0 || to >= photos.length || from === to) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function handleRemove(index: number) {
    setPhotos((prev) => {
      const target = prev[index];
      if (target.kind === 'pending') URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
    if (pickedUpIndex === index) setPickedUpIndex(null);
  }

  function handleCaptionChange(index: number, value: string) {
    setPhotos((prev) =>
      prev.map((p, i) => (i === index ? { ...p, caption: value } : p)),
    );
  }

  function handleRetryTile(index: number) {
    setPhotos((prev) =>
      prev.map((p, i) =>
        i === index && p.kind === 'pending'
          ? { ...p, status: 'idle', errorMessage: undefined }
          : p,
      ),
    );
    void handleSave();
  }

  function handleTileDragStart(index: number, e: React.DragEvent) {
    dragFromIndexRef.current = index;
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleTileDragEnd() {
    dragFromIndexRef.current = null;
    setDragOverIndex(null);
  }

  function handleTileDragOver(index: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleTileDrop(index: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverIndex(null);
    const from = dragFromIndexRef.current;
    dragFromIndexRef.current = null;
    if (from === null) return;
    reorder(from, index);
  }

  // ponytail: arrow keys move the picked-up tile to the adjacent array
  // position regardless of the grid's current column count (4/2/1 at
  // narrower widths) — simplest keyboard reorder that stays correct at
  // every breakpoint; a true 2D grid nav would need to track live column
  // count for no behavior gain the spec asks for.
  function handleHandleKeyDown(index: number, e: React.KeyboardEvent) {
    if (pickedUpIndex === null) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        pickupSnapshotRef.current = photos;
        setPickedUpIndex(index);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pickupSnapshotRef.current) setPhotos(pickupSnapshotRef.current);
      setPickedUpIndex(null);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setPickedUpIndex(null);
      return;
    }
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const delta = deltas[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const to = pickedUpIndex + delta;
    if (to < 0 || to >= photos.length) return;
    reorder(pickedUpIndex, to);
    setPickedUpIndex(to);
  }

  function handleBrowseChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }

  function handleZoneDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDropzoneActive(true);
    }
  }

  function handleZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropzoneActive(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  function handleCancel() {
    if (isDirty(photos, baselineRef.current)) {
      if (!window.confirm('Discard unsaved photos?')) return;
    }
    photos.forEach((p) => {
      if (p.kind === 'pending') URL.revokeObjectURL(p.previewUrl);
    });
    navigate(`/activities/${id}/edit`);
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setSaveError(undefined);

    const working = [...photos];
    for (let i = 0; i < working.length; i++) {
      const p = working[i];
      if (p.kind !== 'pending' || p.uploaded) continue;
      working[i] = { ...p, status: 'uploading' };
      setPhotos([...working]);
      const res = await uploadAdminActivityPhoto(id, p.file);
      if (res.status === 'success') {
        working[i] = { ...p, status: 'idle', uploaded: res.data };
        setPhotos([...working]);
        continue;
      }
      if (res.status === 403) {
        setSaving(false);
        setSaveForbidden(true);
        return;
      }
      working[i] = { ...p, status: 'error', errorMessage: res.message };
      setPhotos([...working]);
      setSaving(false);
      setSaveError(res.message);
      return;
    }

    const payload: PatchAdminActivityPayload = {
      photos: working.map((p) =>
        p.kind === 'existing'
          ? { url: p.url, thumb_url: p.thumb_url, caption: p.caption || undefined }
          : {
              url: p.uploaded!.url,
              thumb_url: p.uploaded!.thumb_url,
              caption: p.caption || undefined,
            },
      ),
    };
    const patchRes = await patchAdminActivity(id, payload);
    setSaving(false);
    if (patchRes.status === 'success') {
      navigate(`/activities/${id}/edit`);
      return;
    }
    if (patchRes.status === 403) {
      setSaveForbidden(true);
      return;
    }
    setPhotos(working);
    setSaveError(patchRes.message);
  }

  if (loadState.kind === 'loading') {
    return <PhotosSkeleton />;
  }

  if (loadState.kind === 'not-found') {
    return (
      <BlockedPanel
        title="Activity not found"
        hint="It may have been removed."
      />
    );
  }

  if (loadState.kind === 'forbidden' || saveForbidden) {
    return (
      <BlockedPanel
        title="Admin access rejected"
        hint={
          <>
            The admin token is missing or incorrect — check{' '}
            <code>VITE_ADMIN_TOKEN</code>.
          </>
        }
      />
    );
  }

  if (loadState.kind === 'load-error') {
    return (
      <BlockedPanel
        title="Couldn't load photos"
        hint={loadState.message}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <div className="admin-page admin-photos-page">
      <header className="admin-top-bar">
        <div className="admin-top-bar-title">
          <p className="admin-photos-breadcrumb">
            <Link to="/activities" className="admin-photos-breadcrumb-link">
              Activities
            </Link>
            <ChevronRight
              size={13}
              aria-hidden="true"
              className="admin-photos-breadcrumb-chevron"
            />
            <Link
              to={`/activities/${id}/edit`}
              className="admin-photos-breadcrumb-link"
            >
              {activityTitle}
            </Link>
            <ChevronRight
              size={13}
              aria-hidden="true"
              className="admin-photos-breadcrumb-chevron"
            />
            <span aria-current="page" className="admin-photos-breadcrumb-current">
              Photos
            </span>
          </p>
          <h1 className="admin-page-title">Manage photos</h1>
          <p className="admin-page-subtitle admin-photos-count">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="admin-top-bar-spacer" />
        <button
          type="button"
          className="admin-control-button"
          onClick={handleCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="admin-primary-button"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 size={16} className="admin-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            'Save gallery'
          )}
        </button>
      </header>

      <div className="admin-error-slot">
        {saveError && (
          <div className="admin-error-banner" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{saveError}</span>
            <button
              type="button"
              className="admin-banner-dismiss"
              aria-label="Dismiss"
              onClick={() => setSaveError(undefined)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div
        className={`admin-photos-dropzone ${dropzoneActive ? 'admin-photos-dropzone-active' : ''}`}
        onDragOver={handleZoneDragOver}
        onDragLeave={() => setDropzoneActive(false)}
        onDrop={handleZoneDrop}
      >
        <Upload
          size={20}
          aria-hidden="true"
          className="admin-photos-dropzone-icon"
        />
        <button
          type="button"
          className="admin-control-button"
          onClick={() => fileInputRef.current?.click()}
        >
          Browse files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          aria-label="Browse files"
          className="admin-photos-file-input"
          onChange={handleBrowseChange}
        />
        <p className="admin-photos-dropzone-hint">
          JPG or PNG, up to 8 MB each · first photo becomes the cover
        </p>
        <p className="admin-photos-dropzone-reject" role="alert">
          {rejectMessage}
        </p>
      </div>

      {photos.length > 0 && (
        <div className="admin-photos-grid">
          {photos.map((photo, index) => (
            <PhotoTile
              key={photoKey(photo)}
              index={index}
              isCover={index === 0}
              src={photo.kind === 'existing' ? photo.url : photo.previewUrl}
              caption={photo.caption}
              status={photo.kind === 'pending' ? photo.status : 'idle'}
              errorMessage={
                photo.kind === 'pending' ? photo.errorMessage : undefined
              }
              pickedUp={pickedUpIndex === index}
              isDropTarget={dragOverIndex === index}
              disabled={saving}
              onRemove={() => handleRemove(index)}
              onSetCover={() => reorder(index, 0)}
              onCaptionChange={(value) => handleCaptionChange(index, value)}
              onRetry={() => handleRetryTile(index)}
              onDragStart={(e) => handleTileDragStart(index, e)}
              onDragEnd={handleTileDragEnd}
              onDragOver={(e) => handleTileDragOver(index, e)}
              onDrop={(e) => handleTileDrop(index, e)}
              onHandleKeyDown={(e) => handleHandleKeyDown(index, e)}
            />
          ))}
          <button
            type="button"
            className="admin-photos-add-tile"
            aria-label="Add photo"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={20} aria-hidden="true" />
            Add photo
          </button>
        </div>
      )}
    </div>
  );
}

function BlockedPanel({
  title,
  hint,
  onRetry,
}: {
  title: string;
  hint: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="admin-page">
      <div className="admin-table-container admin-blocked-panel">
        <AlertCircle
          size={20}
          className="admin-error-icon"
          aria-hidden="true"
        />
        <p className="admin-blocked-title">{title}</p>
        <p className="admin-blocked-hint">{hint}</p>
        {onRetry && (
          <button
            type="button"
            className="admin-control-button"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

function PhotosSkeleton() {
  return (
    <div className="admin-page" aria-busy="true">
      <span className="sr-only">Loading photos…</span>
      <div className="admin-top-bar" aria-hidden="true">
        <div className="admin-top-bar-title">
          <span
            className="admin-skeleton admin-text-skeleton"
            style={{ width: '260px', height: '1.5em' }}
          />
        </div>
      </div>
      <div className="admin-photos-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="admin-skeleton admin-photo-image-box"
            style={{ height: '160px' }}
          />
        ))}
      </div>
    </div>
  );
}
