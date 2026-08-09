export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path
        d="M11 15.5A4.5 4.5 0 0 1 15.5 11h9a4.5 4.5 0 0 1 4.5 4.5v6a4.5 4.5 0 0 1-4.5 4.5h-4.3l-4.8 3.8c-.6.5-1.4 0-1.3-.8l.5-3.3A4.5 4.5 0 0 1 11 21.5v-6Z"
        fill="#0c0b12"
      />
      <circle cx="17" cy="18.5" r="1.5" fill="currentColor" />
      <circle cx="23" cy="18.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Mark />
      <span>OpenStreamAlert</span>
    </span>
  );
}
