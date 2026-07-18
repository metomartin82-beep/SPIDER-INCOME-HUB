// Every "image upload" in this app is actually a URL or base64 data-URI
// string stored straight into a TEXT column (avatar, cover_photo, coverImage,
// mediaUrl) — there's no multer/file upload anywhere. That means validation
// has to happen on the string itself: length, scheme, and format.

const MAX_URL_LENGTH = 2000;           // plain http(s) links
const MAX_DATA_URI_LENGTH = 700000;    // ~525KB raw image once base64-decoded
const ALLOWED_IMAGE_MIME = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/i;

/**
 * Validates a value meant to be an image reference (URL or data URI).
 * @param {string} value - the raw value from req.body
 * @param {{required?: boolean, fieldName?: string}} opts
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function validateImageUrl(value, opts = {}) {
  const { required = false, fieldName = 'Image' } = opts;

  if (value === undefined || value === null || value === '') {
    return required ? { ok: false, error: `${fieldName} is required` } : { ok: true, value: '' };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? { ok: false, error: `${fieldName} is required` } : { ok: true, value: '' };
  }

  // Base64 data URI
  if (trimmed.startsWith('data:')) {
    if (!ALLOWED_IMAGE_MIME.test(trimmed)) {
      return { ok: false, error: `${fieldName} must be a JPEG, PNG, GIF, or WebP image` };
    }
    if (trimmed.length > MAX_DATA_URI_LENGTH) {
      return { ok: false, error: `${fieldName} is too large (max ~500KB)` };
    }
    return { ok: true, value: trimmed };
  }

  // Plain URL
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: `${fieldName} URL is too long` };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `${fieldName} must be a valid URL` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `${fieldName} must use http:// or https://` };
  }
  return { ok: true, value: trimmed };
}

module.exports = { validateImageUrl };
