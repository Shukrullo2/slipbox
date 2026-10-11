// A small stroke icon set drawn for this app (1.6px strokes on a 20px grid).
const PATHS: Record<string, string> = {
  graph: 'M5 6.5a1.8 1.8 0 1 0 0-.01M14.5 4.5a2.5 2.5 0 1 0 0-.01M13 15a1.8 1.8 0 1 0 0-.01M6.6 7.3l5.6 6.5M6.7 6l5.3-1.1M14.1 7l-.9 6.2',
  review: 'M4 5.5h12v10H4zM4 8.5h12M7 12h6',
  timeline: 'M5 4v12M5 6h9M5 10h6M5 14h8',
  search: 'M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5 17 17',
  plus: 'M10 4v12M4 10h12',
  close: 'M5 5l10 10M15 5 5 15',
  edit: 'M4 16l1-4 8.5-8.5 3 3L8 15zM11.5 5.5l3 3',
  trash: 'M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6',
  expand: 'M11.5 4H16v4.5M16 4l-5 5M8.5 16H4v-4.5M4 16l5-5',
  collapse: 'M15.5 8.5H11V4M11 8.5l5-5M4.5 11.5H9V16M9 11.5l-5 5',
  sun: 'M10 13.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3',
  moon: 'M15.5 12.3A6 6 0 0 1 7.7 4.5a6 6 0 1 0 7.8 7.8z',
  auto: 'M10 3.5a6.5 6.5 0 1 0 0 13zM10 3.5a6.5 6.5 0 0 1 0 13',
  link: 'M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.6-1.6a2.5 2.5 0 0 0-3.5-3.5L9.5 7',
  copy: 'M7 7h8.5v9H7zM4.5 13V4H13',
  chevron: 'M6 8l4 4 4-4',
  lock: 'M5 9h10v8H5zM7 9V6.5a3 3 0 0 1 6 0V9',
  sparkle: 'M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6zM15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  book: 'M10 6.2a3 3 0 0 0-2.3-1.2H3.5v10.5h4.4a2.3 2.3 0 0 1 2.1 1.2 2.3 2.3 0 0 1 2.1-1.2h4.4V5h-4.2A3 3 0 0 0 10 6.2zM10 6.2v10.5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
};

export function Icon({ name, size = 18, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
