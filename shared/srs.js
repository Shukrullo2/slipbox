// Spaced-repetition scheduling shared by the server (authoritative) and the
// client (to preview intervals on the review buttons). A simplified SM-2:
// intervals are whole days, ease is stored ×100 (250 = 2.5).

export const GRADES = /** @type {const} */ (['again', 'hard', 'good', 'easy']);

const MIN_EASE = 130;
const MAX_INTERVAL = 365;

/**
 * @param {{ interval?: number | null, ease?: number | null } | null | undefined} state
 * @param {'again' | 'hard' | 'good' | 'easy'} grade
 * @returns {{ interval: number, ease: number }}
 */
export function schedule(state, grade) {
  const prev = Number(state?.interval) || 0;
  let ease = Number(state?.ease) || 250;
  const grown = Math.round((prev * ease) / 100);
  let interval;

  switch (grade) {
    case 'again':
      interval = 1;
      ease = Math.max(MIN_EASE, ease - 20);
      break;
    case 'hard':
      interval = prev === 0 ? 1 : Math.max(1, Math.round(prev * 1.2));
      ease = Math.max(MIN_EASE, ease - 15);
      break;
    case 'good':
      interval = prev === 0 ? 2 : Math.max(prev + 1, grown);
      break;
    case 'easy':
      interval = prev === 0 ? 4 : Math.max(prev + 2, Math.round(grown * 1.3));
      ease += 15;
      break;
    default:
      throw new Error(`Unknown grade: ${grade}`);
  }

  return { interval: Math.min(interval, MAX_INTERVAL), ease };
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @param {string} date YYYY-MM-DD @param {number} days */
export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** @param {number} days */
export function formatInterval(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? 'in a month' : `in ${months} months`;
  }
  return 'in a year';
}

/** How many never-reviewed notes join one review session. */
export const NEW_PER_SESSION = 10;

/**
 * @typedef {{ review: false | { due?: string } , created: string }} Reviewable
 */

/** Due today or overdue. @param {Reviewable} note @param {string} today */
export function isDue(note, today) {
  return note.review !== false && !!note.review.due && note.review.due <= today;
}

/**
 * Never reviewed, and captured before today: recalling a note minutes after
 * writing it is too easy to strengthen memory. @param {Reviewable} note @param {string} today
 */
export function isNew(note, today) {
  return note.review !== false && !note.review.due && note.created < today;
}
