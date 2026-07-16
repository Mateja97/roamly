const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:8080';
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? '';

export type ActivityStatus = 'published' | 'draft' | 'pending';

export interface AdminActivityPhoto {
  url: string;
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

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
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
  return {
    status: 'success',
    data: (await res.json()) as ListAdminActivitiesResponse,
  };
}
