import sanitizeHtml from 'sanitize-html';

// ── Rich-text HTML sanitizer ──────────────────────────────────
// For HTML that comes from a rich-text editor and is later rendered as
// HTML by the frontend (support query messages/replies). Whitelist only:
// everything else — script/style/iframe, event handlers, inline styles,
// javascript: links — is stripped. Always sanitize on the server; never
// trust the client's HTML.
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'div',
    'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'a', 'span',
  ],
  // rel/target are allowed only so the transform below can set them —
  // the transform overwrites whatever the client sent.
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export const sanitizeRichText = (html: string): string => sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();

// True if the HTML shows any text at all — "<p><br></p>", "&nbsp;" or
// whitespace-only editor output counts as empty.
export const hasVisibleText = (html: string): boolean =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;|&#160;|&#xa0;| /gi, ' ')
    .trim().length > 0;
