import { useState } from 'react';
import { Linking, Share } from 'react-native';
import type { Activity } from '../../api/activities';
import { hasValidCoordinates } from '../../api/staticMap';

export const SHARE_FAILED_MESSAGE = 'Could not open the share sheet. Please try again.';

// The screen's OS-handoff surface: every hand-off to a device app (maps,
// share sheet, browser, dialer) shares one busy flag and one error string,
// so the footer/chips/map/link call sites all disable together and all
// surface the same generic error banner.
export function useOSHandoff(activity: Activity) {
  const [ctaBusy, setCtaBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);

  // OS handoff: opens the device's maps app on the activity's coordinates.
  // Surfaces the generic error banner (never a silent no-op) when the intent
  // can't be resolved — DESIGN_STANDARDS.md's Error banner recipe.
  async function openDirections() {
    if (!hasValidCoordinates(activity.location)) {
      setCtaError('This activity has no location to get directions to.');
      return;
    }
    setCtaBusy(true);
    const url = `https://www.google.com/maps/dir/?api=1&destination=${activity.location.lat},${activity.location.lng}`;
    try {
      await Linking.openURL(url);
    } catch {
      setCtaError('Could not open maps. Please try again.');
    } finally {
      setCtaBusy(false);
    }
  }

  async function openShare() {
    setCtaBusy(true);
    try {
      await Share.share({
        message: `${activity.title} — ${activity.description}`,
      });
    } catch {
      setCtaError(SHARE_FAILED_MESSAGE);
    } finally {
      setCtaBusy(false);
    }
  }

  // design-spec.md: the non-directions categories' primary CTA (and any
  // category's Website chip) opens their external `website_url` via the
  // same async/error pattern as openDirections above.
  async function openExternalLink(url: string) {
    setCtaBusy(true);
    try {
      await Linking.openURL(url);
    } catch {
      setCtaError('Could not open the link. Please try again.');
    } finally {
      setCtaBusy(false);
    }
  }

  // design-spec.md's Place-facts list: "Phone... rendered as a tel: link
  // (tap to call)". Reuses `openExternalLink`'s existing async/error-banner
  // handling — a `tel:` URL fails the same way any other OS handoff can
  // (e.g. simulator has no phone app), and it should surface the same
  // generic error banner rather than a silent no-op.
  function handleCallPhone(phone: string) {
    return openExternalLink(`tel:${phone}`);
  }

  return {
    ctaBusy,
    ctaError,
    setCtaError,
    openDirections,
    openShare,
    openExternalLink,
    handleCallPhone,
  };
}
