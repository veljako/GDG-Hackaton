import { useEffect, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

export function usePagination<T>(items: T[], resetKey: string) {
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1200px)").matches,
  );
  const [selection, setSelection] = useState({ key: resetKey, page: 0 });
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const sync = () => setWide(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const size = wide ? 6 : 4;
  useEffect(() => {
    setSelection({ key: resetKey, page: 0 });
  }, [resetKey, size]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page =
    selection.key === resetKey ? Math.min(selection.page, pages - 1) : 0;
  return {
    items: items.slice(page * size, (page + 1) * size),
    page,
    pages,
    setPage: (next: number) =>
      setSelection({
        key: resetKey,
        page: Math.max(0, Math.min(next, pages - 1)),
      }),
  };
}

export function Pagination({
  page,
  pages,
  setPage,
}: {
  page: number;
  pages: number;
  setPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Results pages">
      <button
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      >
        <CaretLeft size={18} />
      </button>
      <span role="status">
        Page {page + 1} of {pages}
      </span>
      <button
        aria-label="Next page"
        disabled={page === pages - 1}
        onClick={() => setPage(page + 1)}
      >
        <CaretRight size={18} />
      </button>
    </nav>
  );
}
