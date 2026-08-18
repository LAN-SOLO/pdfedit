/** Hand-rolled icon set — stroke-based, 20x20, currentColor. No icon library
 *  dependency: this project doesn't pull in new packages without a reason,
 *  and a dozen simple line icons don't need one. */
type Props = { size?: number };

const base = {
  viewBox: '0 0 20 20',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconSelect = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M4 3l12 5.2-5 1.8-1.8 5L4 3z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHighlight = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M6 14l-2.5 3M8.5 6.5l5 5-4 4-5-5 4-4z" />
    <path d="M12.5 4.5l3 3-2 2-3-3 2-2z" />
  </svg>
);

export const IconText = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M4 5h12M10 5v10" />
  </svg>
);

export const IconDraw = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M3 17c2-1 3-1 4-3 2-4 3-8 6-10 1.3-1 3 .7 2 2-2 3-6 4-10 6-2 1-2 2-2 5z" />
  </svg>
);

export const IconStamp = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="3" y="13" width="14" height="3" rx="0.8" />
    <path d="M7 13V9a3 3 0 0 1 6 0v4" />
    <path d="M9 6.5V5M11 6.5V5" />
  </svg>
);

export const IconRedact = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="3" y="6" width="14" height="8" rx="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPages = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="5" y="3" width="9" height="12" rx="1" />
    <path d="M8 17.5h9a1 1 0 0 0 1-1V6" />
  </svg>
);

export const IconCompress = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M3 8V4h4M17 12v4h-4M17 4l-6 6M3 16l6-6" />
  </svg>
);

export const IconFlatten = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="3.5" y="4" width="13" height="12" rx="1.2" />
    <path d="M6.5 8h7M6.5 11h4" />
  </svg>
);

export const IconSave = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M10 3v9M6 8.5L10 12.5l4-4" />
    <path d="M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
  </svg>
);

export const IconSearch = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="M16.2 16.2l-3.5-3.5" />
  </svg>
);

export const IconZoomOut = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="M16.2 16.2l-3.5-3.5M6 8.5h5" />
  </svg>
);

export const IconZoomIn = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="M16.2 16.2l-3.5-3.5M8.5 6v5M6 8.5h5" />
  </svg>
);

export const IconFitWidth = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="6" y="3" width="8" height="14" rx="0.8" />
    <path d="M2 10h2M16 10h2" />
  </svg>
);

export const IconFitPage = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="4" y="3" width="12" height="14" rx="0.8" />
  </svg>
);

export const IconSidebar = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <rect x="3" y="3.5" width="14" height="13" rx="1.2" />
    <path d="M8.2 3.5v13" />
  </svg>
);

export const IconOpen = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M3 6.5a1 1 0 0 1 1-1h3.5l1.3 1.7H16a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6.5z" />
  </svg>
);

export const IconPlus = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const IconClose = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export const IconChevronLeft = ({ size = 18 }: Props) => (
  <svg width={size} height={size} {...base}>
    <path d="M12 4l-6 6 6 6" />
  </svg>
);
