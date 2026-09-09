/**
 * Venue rows currently contain twelve stored fields, and the seeded rows are
 * about 250 bytes when JSON encoded. A 32-row page stays below 32 KiB with
 * room for Convex's document overhead; eight such pages support 256 active
 * venues before the reader fails explicitly instead of ranking a prefix.
 */
export const VENUE_PAGE_SIZE = 32;
// One lookahead row lets Convex prove a full page without returning
// SplitRequired solely because the page-size boundary was reached.
export const VENUE_PAGE_MAX_ROWS = VENUE_PAGE_SIZE + 1;
export const VENUE_PAGE_MAX_BYTES = 32 * 1024;
export const VENUE_CATALOG_CEILING = VENUE_PAGE_SIZE * 8;
