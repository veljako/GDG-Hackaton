/** Decorative brand geometry stays outside the reading and interaction layer. */
export function BrandGeometry() {
  return (
    <svg className="brand-geometry" viewBox="0 0 480 250" aria-hidden="true">
      <path
        fill="#ffdb39"
        d="M158 14C158 88 126 120 52 120c74 0 106 32 106 106 0-74 32-106 106-106-74 0-106-32-106-106Z"
      />
      <circle cx="349" cy="69" r="58" fill="#ff745e" />
      <path
        fill="#82efc5"
        d="M291 154a68 68 0 0 1 136 0Z"
        transform="rotate(-24 359 154)"
      />
      <path
        fill="#f5f6ff"
        d="m271 182 34 58h-68Z"
        transform="rotate(18 271 212)"
      />
      <circle
        cx="50"
        cy="214"
        r="18"
        fill="none"
        stroke="#f5f6ff"
        strokeWidth="10"
      />
      <path
        fill="#82efc5"
        d="M257 20c0 19-8 27-27 27 19 0 27 8 27 27 0-19 8-27 27-27-19 0-27-8-27-27Z"
      />
    </svg>
  );
}
export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="loading-shapes" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <strong>Good things are coming together.</strong>
      <span>Loading your community…</span>
    </div>
  );
}
