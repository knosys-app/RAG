import type { DocumentReview, DocumentSummary } from "@knosys-rag/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentReviewDialog } from "@/components/library/DocumentReviewDialog";
import type { UseLibrary } from "@/hooks/useLibrary";

afterEach(cleanup);

const WARNING_DOC: DocumentSummary = {
  createdAt: "2026-08-21T00:00:00.000Z",
  diagnosticCount: 1,
  errorCode: null,
  errorMessage: null,
  format: "pdf",
  id: "11111111-1111-4111-8111-111111111111",
  originalName: "guide.pdf",
  reviewedAt: null,
  sizeBytes: 4096,
  status: "ready-with-warnings",
  title: "Growing Guide",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

const FAILED_DOC: DocumentSummary = {
  ...WARNING_DOC,
  diagnosticCount: 0,
  errorCode: "PDF_OCR_REQUIRED",
  errorMessage: "Every page is a scanned image.",
  status: "failed",
};

const REVIEW: DocumentReview = {
  diagnostics: [
    {
      code: "PDF_PAGES_REQUIRE_OCR",
      location: { pageNumber: 3 },
      message: "3 of 40 pages contain no selectable text.",
      severity: "warning",
    },
  ],
  document: WARNING_DOC,
};

function makeLibrary(overrides: Partial<UseLibrary> = {}): UseLibrary {
  return {
    acknowledgeReview: vi.fn().mockResolvedValue(null),
    deleteDocument: vi.fn().mockResolvedValue(null),
    getDocumentReview: vi.fn().mockResolvedValue(REVIEW),
    replaceDocument: vi.fn().mockResolvedValue(null),
    reprocessDocument: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as UseLibrary;
}

describe("DocumentReviewDialog", () => {
  it("walks through a warning document and marks it reviewed", async () => {
    const library = makeLibrary();
    const onClose = vi.fn();
    render(
      <DocumentReviewDialog document={WARNING_DOC} library={library} onClose={onClose} />,
    );

    await waitFor(() =>
      expect(library.getDocumentReview).toHaveBeenCalledWith(WARNING_DOC.id),
    );

    // Intro step → begin.
    fireEvent.click(screen.getByRole("button", { name: /start review/i }));

    // Issue step shows the plain-language explanation and its page location.
    expect(await screen.findByText(/Some pages are scanned images/i)).toBeTruthy();
    expect(screen.getByText("Page 3")).toBeTruthy();

    // Advance to the resolution step.
    fireEvent.click(screen.getByRole("button", { name: /choose action/i }));

    const keepButton = screen.getByRole("button", { name: /keep & mark reviewed/i });
    fireEvent.click(keepButton);

    await waitFor(() =>
      expect(library.acknowledgeReview).toHaveBeenCalledWith(WARNING_DOC.id),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps its place when the parent re-renders with a new library object", async () => {
    // The real useLibrary hook returns a fresh object each render but stable
    // memoized methods; reproduce that by sharing the method reference across
    // two distinct library objects.
    const getDocumentReview = vi.fn().mockResolvedValue(REVIEW);
    const { rerender } = render(
      <DocumentReviewDialog
        document={WARNING_DOC}
        library={makeLibrary({ getDocumentReview })}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start review/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /start review/i }));
    expect(await screen.findByText(/Some pages are scanned images/i)).toBeTruthy();

    // An unrelated parent re-render hands down a brand-new library object.
    rerender(
      <DocumentReviewDialog
        document={WARNING_DOC}
        library={makeLibrary({ getDocumentReview })}
        onClose={vi.fn()}
      />,
    );

    // Still on the issue step — not thrown back to the intro.
    expect(screen.getByText(/Some pages are scanned images/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start review/i })).toBeNull();
  });

  it("offers no acknowledge action for a failed document", async () => {
    const library = makeLibrary();
    render(
      <DocumentReviewDialog document={FAILED_DOC} library={library} onClose={vi.fn()} />,
    );

    // Failed documents carry their reason on the summary; no review fetch needed.
    expect(library.getDocumentReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /start review/i }));
    expect(
      await screen.findByText(/This PDF is entirely scanned images/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /choose action/i }));
    expect(screen.queryByRole("button", { name: /keep & mark reviewed/i })).toBeNull();
    expect(screen.getByRole("button", { name: /replace file/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("re-runs the import from the stored copy when chosen", async () => {
    const reprocessDocument = vi.fn().mockResolvedValue(null);
    const onClose = vi.fn();
    render(
      <DocumentReviewDialog
        document={WARNING_DOC}
        library={makeLibrary({ reprocessDocument })}
        onClose={onClose}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start review/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /start review/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose action/i }));
    fireEvent.click(screen.getByRole("button", { name: /re-run import/i }));

    await waitFor(() => expect(reprocessDocument).toHaveBeenCalledWith(WARNING_DOC.id));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("replaces the source when the user chooses replace", async () => {
    const replaceDocument = vi.fn().mockResolvedValue(null);
    const onClose = vi.fn();
    render(
      <DocumentReviewDialog
        document={FAILED_DOC}
        library={makeLibrary({ replaceDocument })}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start review/i }));
    fireEvent.click(screen.getByRole("button", { name: /choose action/i }));
    fireEvent.click(screen.getByRole("button", { name: /replace file/i }));

    await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith(FAILED_DOC.id));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("walks only actionable issues, skipping informational notes", async () => {
    const mixedReview: DocumentReview = {
      diagnostics: [
        {
          code: "PDF_SUSPICIOUS_CHARACTERS",
          message: "The extracted text contains an unusual number of characters.",
          severity: "warning",
        },
        {
          code: "PDF_REPEATED_MARGINS_OMITTED",
          message: "20 repeated header or footer lines were omitted.",
          severity: "info",
        },
        {
          code: "PDF_PAGES_REQUIRE_OCR",
          location: { pageNumber: 3 },
          message: "1 of 22 pages contain no selectable text.",
          severity: "info",
        },
      ],
      document: WARNING_DOC,
    };
    const library = makeLibrary({
      getDocumentReview: vi.fn().mockResolvedValue(mixedReview),
    });
    render(
      <DocumentReviewDialog document={WARNING_DOC} library={library} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(library.getDocumentReview).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /start review/i }));

    // The single actionable warning is shown as the only issue step: the button
    // reads "Choose action" (not "Next"), so advancing lands on the resolution.
    expect(await screen.findByText(/Unusual characters in the text/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /choose action/i }));
    expect(screen.getByRole("button", { name: /re-run import/i })).toBeTruthy();

    // The informational notes never appear as review steps.
    expect(screen.queryByText(/Repeated headers\/footers removed/i)).toBeNull();
    expect(screen.queryByText(/Some pages are scanned images/i)).toBeNull();
  });
});
