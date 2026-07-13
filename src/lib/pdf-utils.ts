export function pageLabel(page: number, pageCount?: number) {
  return pageCount ? `Page ${page} of ${pageCount}` : `Page ${page}`;
}

export function inferredPaperTitle(fileName: string) {
  return fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled paper';
}
