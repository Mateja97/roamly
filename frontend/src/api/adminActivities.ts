const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:8080';
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? '';

export type ActivityStatus = 'published' | 'draft' | 'pending';

export interface AdminActivityPhoto {
  url: string;
  thumb_url?: string;
  caption?: string;
}

export interface AdminActivitySummary {
  id: string;
  title: string;
  category: string;
  city: string;
  status: ActivityStatus;
  rating: number;
  photos: AdminActivityPhoto[];
}

export interface AdminActivityStats {
  total: number;
  published: number;
  draft: number;
  pending: number;
}

export interface ListAdminActivitiesResponse {
  activities: AdminActivitySummary[];
  total: number;
  page: number;
  page_size: number;
  stats: AdminActivityStats;
}

export interface ListAdminActivitiesParams {
  q?: string;
  category?: string;
  city?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export interface Location {
  lat: number;
  lng: number;
}

/** The full activity (`GET /admin/activities/{id}` and the create/patch
 * responses). `location`/`created_at` are typed optional: the current
 * merged backend's `adminActivityDTO` doesn't carry either (see T4's
 * engineering notes) even though the dispatched contract named them, so
 * they read as genuinely absent today — this widens to real data with no
 * frontend change the day a backend task wires them in. */
export interface AdminActivityDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  city: string;
  address: string;
  status: ActivityStatus;
  rating: number;
  details: Record<string, unknown>;
  photos: AdminActivityPhoto[];
  location?: Location;
  created_at?: string;
}

/** Any subset of these — omitted keys stay untouched server-side. */
export interface PatchAdminActivityPayload {
  title?: string;
  description?: string;
  category?: string;
  city?: string;
  address?: string;
  status?: string;
  details?: Record<string, unknown>;
  photos?: AdminActivityPhoto[];
}

export interface CreateAdminActivityPayload {
  title: string;
  category: string;
  description?: string;
  city?: string;
  address?: string;
  status?: string;
  details?: Record<string, unknown>;
  photos?: AdminActivityPhoto[];
}

/**
 * Discriminated result union `FRONTEND_STANDARDS.md` mandates for every
 * `src/api/` call — never an opaque throw. Every call site must handle
 * every branch (403 in particular: the admin token is the most likely
 * misconfiguration).
 */
export type AdminApiResult<T> =
  | { status: 'success'; data: T }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

const KNOWN_ERROR_STATUSES = [400, 403, 404, 409, 500] as const;

async function toErrorResult(res: Response): Promise<AdminApiResult<never>> {
  // ponytail: proxy-service's fixed contract only ever returns these five
  // codes (see backend/proxy-service/README.md); an unlisted code (should
  // never happen) folds into 500 rather than producing an invalid union
  // member.
  const status = (KNOWN_ERROR_STATUSES as readonly number[]).includes(
    res.status,
  )
    ? (res.status as 400 | 403 | 404 | 409 | 500)
    : 500;
  let message = `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // ponytail: a non-JSON error body (e.g. a proxy/gateway 502 page) falls
    // back to the generic message above rather than throwing here too.
  }
  return { status, message };
}

/** Shared fetch + result-union wrapper for every `/admin/*` call — the
 * network-failure catch and the error-branch translation were identical
 * across list/get/patch/create; this is the one place that logic lives. */
async function adminRequest<T>(
  url: string | URL,
  init?: RequestInit,
): Promise<AdminApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...init?.headers, 'X-Admin-Token': ADMIN_TOKEN },
    });
  } catch {
    // A network-level failure (proxy-service unreachable, DNS, CORS) never
    // reaches an HTTP status — surface it as the generic 500 branch rather
    // than an unhandled rejection that leaves the caller stuck on "loading".
    return {
      status: 500,
      message:
        'Could not reach the server. Check your connection and try again.',
    };
  }
  if (!res.ok) return toErrorResult(res);
  return { status: 'success', data: (await res.json()) as T };
}

export async function listAdminActivities(
  params: ListAdminActivitiesParams,
): Promise<AdminApiResult<ListAdminActivitiesResponse>> {
  const url = new URL('/admin/activities', PROXY_URL);
  if (params.q) url.searchParams.set('q', params.q);
  if (params.category) url.searchParams.set('category', params.category);
  if (params.city) url.searchParams.set('city', params.city);
  if (params.status) url.searchParams.set('status', params.status);
  if (params.page) url.searchParams.set('page', String(params.page));
  if (params.page_size)
    url.searchParams.set('page_size', String(params.page_size));

  return adminRequest<ListAdminActivitiesResponse>(url);
}

export async function getAdminActivity(
  id: string,
): Promise<AdminApiResult<AdminActivityDetail>> {
  const url = new URL(`/admin/activities/${encodeURIComponent(id)}`, PROXY_URL);
  return adminRequest<AdminActivityDetail>(url);
}

export async function patchAdminActivity(
  id: string,
  payload: PatchAdminActivityPayload,
): Promise<AdminApiResult<AdminActivityDetail>> {
  const url = new URL(`/admin/activities/${encodeURIComponent(id)}`, PROXY_URL);
  return adminRequest<AdminActivityDetail>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface UploadPhotoResponse {
  url: string;
  thumb_url: string;
}

/** `POST /admin/activities/{id}/photos` — one file per call (the "Manage
 * photos" page's Save gallery posts each staged file in turn, then issues
 * one PATCH). Body is `FormData`; no `Content-Type` header is set so the
 * browser attaches the multipart boundary itself. */
export async function uploadAdminActivityPhoto(
  id: string,
  file: File,
): Promise<AdminApiResult<UploadPhotoResponse>> {
  const url = new URL(
    `/admin/activities/${encodeURIComponent(id)}/photos`,
    PROXY_URL,
  );
  const body = new FormData();
  body.append('file', file);
  return adminRequest<UploadPhotoResponse>(url, { method: 'POST', body });
}

export async function createAdminActivity(
  payload: CreateAdminActivityPayload,
): Promise<AdminApiResult<AdminActivityDetail>> {
  const url = new URL('/admin/activities', PROXY_URL);
  return adminRequest<AdminActivityDetail>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
