import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, X } from 'lucide-react';
import {
  createAdminActivity,
  getAdminActivity,
  patchAdminActivity,
  type ActivityStatus,
  type AdminActivityDetail,
  type AdminActivityPhoto,
  type CreateAdminActivityPayload,
  type PatchAdminActivityPayload,
} from '../../../api/adminActivities';
import { BasicsSection } from './BasicsSection';
import { DetailsSection } from './DetailsSection';
import type { OpeningHoursFieldHandle } from './controls/OpeningHoursField';
import { LocationSection } from './LocationSection';
import { PhotosSection } from './PhotosSection';
import { StatusSection } from './StatusSection';
import { EditActivityHeader } from './EditActivityHeader';
import './Edit.css';

interface FormState {
  title: string;
  description: string;
  category: string;
  city: string;
  address: string;
  status: ActivityStatus;
  details: Record<string, unknown>;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  category: '',
  city: '',
  address: '',
  status: 'draft',
  details: {},
};

function toFormState(activity: AdminActivityDetail): FormState {
  return {
    title: activity.title,
    description: activity.description,
    category: activity.category,
    city: activity.city,
    address: activity.address,
    status: activity.status,
    details: activity.details,
  };
}

/** Only the fields that actually changed vs. the loaded snapshot — the
 * PATCH contract leaves omitted fields untouched server-side, so sending
 * everything every time would risk clobbering a concurrent edit. */
function buildPatch(
  current: FormState,
  original: FormState,
): PatchAdminActivityPayload {
  const patch: PatchAdminActivityPayload = {};
  if (current.title !== original.title) patch.title = current.title;
  if (current.description !== original.description)
    patch.description = current.description;
  if (current.category !== original.category) patch.category = current.category;
  if (current.city !== original.city) patch.city = current.city;
  if (current.address !== original.address) patch.address = current.address;
  if (current.status !== original.status) patch.status = current.status;
  if (JSON.stringify(current.details) !== JSON.stringify(original.details))
    patch.details = current.details;
  return patch;
}

function toCreatePayload(form: FormState): CreateAdminActivityPayload {
  return {
    title: form.title,
    category: form.category,
    description: form.description || undefined,
    city: form.city || undefined,
    address: form.address || undefined,
    status: form.status,
    details: Object.keys(form.details).length > 0 ? form.details : undefined,
  };
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'load-error'; message: string };

/** The edit/create form (design `7b`) — one route/layout, two modes. Edit
 * (`/activities/:id/edit`) loads and populates every field; Create
 * (`/activities/new`) renders the same layout empty, status pre-set to
 * Draft, no photos/map/created line. */
export function EditActivityPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = id === undefined;

  const [loadState, setLoadState] = useState<LoadState>(
    isCreate ? { kind: 'loaded' } : { kind: 'loading' },
  );
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const originalRef = useRef<FormState>(EMPTY_FORM);
  const [photos, setPhotos] = useState<AdminActivityPhoto[]>([]);
  const [location, setLocation] = useState<AdminActivityDetail['location']>();
  const [createdAt, setCreatedAt] = useState<string>();

  useEffect(() => {
    if (isCreate || !id) return;
    let cancelled = false;
    setLoadState({ kind: 'loading' });
    getAdminActivity(id).then((res) => {
      if (cancelled) return;
      if (res.status === 'success') {
        const next = toFormState(res.data);
        setForm(next);
        originalRef.current = next;
        setPhotos(res.data.photos);
        setLocation(res.data.location);
        setCreatedAt(res.data.created_at);
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
  }, [id, isCreate]);

  const [nameError, setNameError] = useState<string>();
  const [categoryError, setCategoryError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const openingHoursRef = useRef<OpeningHoursFieldHandle>(null);

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [submitForbidden, setSubmitForbidden] = useState(false);

  function validateName(value = form.title) {
    const error = value.trim() ? undefined : 'Enter an activity name';
    setNameError(error);
    return !error;
  }

  function validateCategory(value = form.category) {
    const error = value ? undefined : 'Choose a category';
    setCategoryError(error);
    return !error;
  }

  async function handleSave() {
    const nameValid = validateName();
    const categoryValid = validateCategory();
    if (!nameValid) {
      nameRef.current?.focus();
      return;
    }
    if (!categoryValid) {
      categoryRef.current?.focus();
      return;
    }
    // Not rendered for out-of-scope categories (ref stays null) — nothing
    // to block on, so default to valid.
    const hoursValid = openingHoursRef.current?.validate() ?? true;
    if (!hoursValid) {
      return;
    }

    setSaving(true);
    setSubmitError(undefined);
    const result = isCreate
      ? await createAdminActivity(toCreatePayload(form))
      : await patchAdminActivity(id!, buildPatch(form, originalRef.current));
    setSaving(false);

    if (result.status === 'success') {
      navigate('/activities');
      return;
    }
    if (result.status === 403) {
      setSubmitForbidden(true);
      return;
    }
    // 400/404/409/500: banner + preserve every field the user typed.
    setSubmitError(result.message);
  }

  if (loadState.kind === 'loading') {
    return <FormSkeleton />;
  }

  if (loadState.kind === 'not-found') {
    return (
      <BlockedPanel
        title="Activity not found"
        hint="It may have been removed."
      />
    );
  }

  if (loadState.kind === 'forbidden' || submitForbidden) {
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
      <BlockedPanel title="Couldn't load activity" hint={loadState.message} />
    );
  }

  return (
    <div className="admin-page admin-edit-page">
      <EditActivityHeader
        isCreate={isCreate}
        activityTitle={form.title}
        status={form.status}
        saving={saving}
        onCancel={() => navigate('/activities')}
        onSave={handleSave}
      />

      <div className="admin-error-slot">
        {submitError && (
          <div className="admin-error-banner" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{submitError}</span>
            <button
              type="button"
              className="admin-banner-dismiss"
              aria-label="Dismiss"
              onClick={() => setSubmitError(undefined)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="admin-edit-columns">
        <div className="admin-edit-column-main">
          <BasicsSection
            name={form.title}
            onNameChange={(title) => setForm((f) => ({ ...f, title }))}
            onNameBlur={() => validateName()}
            nameError={nameError}
            nameInputRef={nameRef}
            category={form.category}
            onCategoryChange={(category) =>
              // Category switch clears `details`: the backend's per-
              // category validator (activity.go's ValidateDetails) uses
              // `json.Decoder.DisallowUnknownFields`, a *strict* decode —
              // a leftover key from the old category's shape mixed into a
              // save that also touches Details would 400 ("details do
              // not match category"), not silently ignore it. Design-
              // spec.md's T4 section says switching category "preserves
              // untouched keys in the PATCH payload", which doesn't hold
              // against that strict decode; clearing on switch is the
              // corrected, save-safe behavior (data belonging to the old
              // shape is already expected to be lost per the same spec
              // text — this only drops the one clause that would break
              // Save).
              setForm((f) => ({ ...f, category, details: {} }))
            }
            onCategoryBlur={() => validateCategory()}
            categoryError={categoryError}
            categorySelectRef={categoryRef}
            city={form.city}
            onCityChange={(city) => setForm((f) => ({ ...f, city }))}
            description={form.description}
            onDescriptionChange={(description) =>
              setForm((f) => ({ ...f, description }))
            }
            disabled={saving}
          />
          <DetailsSection
            category={form.category}
            details={form.details}
            onChange={(details) => setForm((f) => ({ ...f, details }))}
            disabled={saving}
            openingHoursRef={openingHoursRef}
          />
          <LocationSection
            address={form.address}
            onAddressChange={(address) => setForm((f) => ({ ...f, address }))}
            city={form.city}
            onCityChange={(city) => setForm((f) => ({ ...f, city }))}
            location={location}
            disabled={saving}
          />
        </div>
        <div className="admin-edit-column-side">
          <PhotosSection
            title={form.title}
            photos={photos}
            activityId={isCreate ? undefined : id}
          />
          <StatusSection
            status={form.status}
            onStatusChange={(status) => setForm((f) => ({ ...f, status }))}
            createdAt={isCreate ? undefined : createdAt}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}

function BlockedPanel({
  title,
  hint,
}: {
  title: string;
  hint: React.ReactNode;
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
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="admin-page" aria-hidden="true">
      <div className="admin-top-bar">
        <span
          className="admin-skeleton admin-text-skeleton"
          style={{ width: '220px', height: '1.5em' }}
        />
      </div>
      <div className="admin-edit-columns">
        <div className="admin-edit-column-main">
          {['Basics', 'Details', 'Location'].map((label) => (
            <div className="admin-card admin-section" key={label}>
              <span
                className="admin-skeleton admin-text-skeleton"
                style={{ width: '30%', height: '1.2em' }}
              />
              <span
                className="admin-skeleton"
                style={{
                  width: '100%',
                  height: '90px',
                  marginTop: 'var(--space-3)',
                }}
              />
            </div>
          ))}
        </div>
        <div className="admin-edit-column-side">
          {['Cover photo', 'Status'].map((label) => (
            <div className="admin-card admin-section" key={label}>
              <span
                className="admin-skeleton admin-text-skeleton"
                style={{ width: '40%', height: '1.2em' }}
              />
              <span
                className="admin-skeleton"
                style={{
                  width: '100%',
                  height: '130px',
                  marginTop: 'var(--space-3)',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
