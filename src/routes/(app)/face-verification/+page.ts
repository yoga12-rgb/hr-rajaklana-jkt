import { redirect } from '@sveltejs/kit';

// Keep old bookmarks useful without loading enrollment, camera or biometric data.
export function load(): never {
  redirect(307, '/attendance?notice=face-verification-retired');
}
