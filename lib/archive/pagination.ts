export const ARCHIVE_PAGE_CHAR_BUDGET = 35000;
export const ARCHIVE_MIN_MESSAGES_PER_PAGE = 10;
export const ARCHIVE_MAX_VISIBLE_PAGINATION_PAGES = 5;

type PaginatedArchiveMessage = {
  text?: string | null;
  content?: string | null;
};

export type ArchivePaginationPageNumber = number | "...";

export function paginateArchiveMessages<T extends PaginatedArchiveMessage>(
  messages: T[],
  pageCharBudget = ARCHIVE_PAGE_CHAR_BUDGET,
  minMessagesPerPage = ARCHIVE_MIN_MESSAGES_PER_PAGE
): T[][] {
  if (!messages || messages.length === 0) {
    return [[]];
  }

  const pages: T[][] = [];
  let currentPage: T[] = [];
  let currentLen = 0;

  for (const message of messages) {
    const text = typeof message.text === "string"
      ? message.text
      : typeof message.content === "string"
      ? message.content
      : "";
    const messageLength = text.length;
    const wouldExceedBudget = currentLen + messageLength > pageCharBudget;
    const hasMinMessages = currentPage.length >= minMessagesPerPage;

    if (currentPage.length > 0 && wouldExceedBudget && hasMinMessages) {
      pages.push(currentPage);
      currentPage = [];
      currentLen = 0;
    }

    currentPage.push(message);
    currentLen += messageLength;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages.length > 0 ? pages : [[]];
}

export function getSafeArchivePageIndex(
  requestedPageIndex: number,
  totalPages: number
): number {
  if (totalPages <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(requestedPageIndex, totalPages - 1));
}

export function buildArchivePaginationPageNumbers(
  totalPages: number,
  activePageIndex: number,
  maxVisiblePages = ARCHIVE_MAX_VISIBLE_PAGINATION_PAGES
): ArchivePaginationPageNumber[] {
  if (totalPages <= 0) {
    return [];
  }

  const pageNumbers: ArchivePaginationPageNumber[] = [];
  const currentPageNum = activePageIndex + 1;

  if (totalPages <= maxVisiblePages) {
    for (let i = 1; i <= totalPages; i += 1) {
      pageNumbers.push(i);
    }
    return pageNumbers;
  }

  if (currentPageNum <= 3) {
    for (let i = 1; i <= 5; i += 1) {
      pageNumbers.push(i);
    }
    pageNumbers.push("...");
    pageNumbers.push(totalPages);
    return pageNumbers;
  }

  if (currentPageNum >= totalPages - 2) {
    pageNumbers.push(1);
    pageNumbers.push("...");
    for (let i = totalPages - 4; i <= totalPages; i += 1) {
      pageNumbers.push(i);
    }
    return pageNumbers;
  }

  pageNumbers.push(1);
  pageNumbers.push("...");
  for (let i = currentPageNum - 2; i <= currentPageNum + 2; i += 1) {
    pageNumbers.push(i);
  }
  pageNumbers.push("...");
  pageNumbers.push(totalPages);
  return pageNumbers;
}
