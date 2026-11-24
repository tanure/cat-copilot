export const PAGE_SIZE = 50;

export function pageWindow(total: number, requestedPage: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(requested, pages - 1));
  const start = page * size;
  return { page, pages, start, end: Math.min(total, start + size), total };
}
