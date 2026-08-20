import type { ChatCitation, SearchResult } from "@knosys-rag/contracts";

export function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "unit",
    unit: bytes >= 1024 ** 3 ? "gigabyte" : "megabyte",
    unitDisplay: "short",
  }).format(bytes / (bytes >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function formatThreadDate(value: string | null): string {
  if (!value) return "No messages";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function formatModelSize(bytes: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "unit",
    unit: bytes >= 1024 ** 3 ? "gigabyte" : "megabyte",
    unitDisplay: "short",
  }).format(bytes / (bytes >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2));
}

export function citationPageLabel(citation: ChatCitation): string | null {
  const startPage = citation.sourceLocator.start.pageNumber;
  const endPage = citation.sourceLocator.end.pageNumber;
  if (startPage === null) return null;
  return endPage === null || endPage === startPage
    ? `Page ${startPage}`
    : `Pages ${startPage}-${endPage}`;
}

export function searchLocation(result: SearchResult): string | null {
  if (result.startPageNumber === null) return null;
  return result.endPageNumber === null || result.endPageNumber === result.startPageNumber
    ? `Page ${result.startPageNumber}`
    : `Pages ${result.startPageNumber}-${result.endPageNumber}`;
}
