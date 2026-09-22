// Inline SVG icons (decorative: aria-hidden). Built with createElementNS, CSP-safe.
const NS = 'http://www.w3.org/2000/svg';

const P = {
  mic: [['rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['path', { d: 'M12 18v4M8 22h8' }]],
  scan: [['path', { d: 'M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3' }], ['rect', { x: 8, y: 8, width: 3, height: 3 }], ['rect', { x: 13, y: 8, width: 3, height: 3 }], ['rect', { x: 8, y: 13, width: 3, height: 3 }], ['path', { d: 'M14 14h2v2h-2z' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
  users: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2 21a7 7 0 0 1 14 0' }], ['path', { d: 'M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a7 7 0 0 1 4 6.5' }]],
  at: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8' }]],
  receipt: [['path', { d: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z' }], ['path', { d: 'M9 8h6M9 12h6' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  wallet: [['path', { d: 'M3 7a2 2 0 0 1 2-2h13v4' }], ['path', { d: 'M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z' }], ['circle', { cx: 16.5, cy: 14.5, r: 1 }]],
  home: [['path', { d: 'M3 11l9-8 9 8' }], ['path', { d: 'M5 10v10h14V10' }], ['path', { d: 'M10 20v-6h4v6' }]],
  settings: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1' }]],
  bank: [['path', { d: 'M3 10l9-6 9 6' }], ['path', { d: 'M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  check: [['path', { d: 'M4 12.5l5 5L20 6.5' }]],
  x: [['path', { d: 'M5 5l14 14M19 5L5 19' }]],
  alert: [['path', { d: 'M12 3l10 18H2z' }], ['path', { d: 'M12 10v5M12 18v.5' }]],
  shield: [['path', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
  volume: [['path', { d: 'M4 9v6h4l5 4V5L8 9z' }], ['path', { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' }]],
  stop: [['path', { d: 'M8 3h8l5 5v8l-5 5H8l-5-5V8z' }], ['path', { d: 'M9 9h6v6H9z' }]],
  back: [['path', { d: 'M19 12H5M11 5l-7 7 7 7' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M21 21l-5-5' }]],
  star: [['path', { d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' }]],
  trash: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16z' }]],
  share: [['circle', { cx: 6, cy: 12, r: 2.5 }], ['circle', { cx: 18, cy: 6, r: 2.5 }], ['circle', { cx: 18, cy: 18, r: 2.5 }], ['path', { d: 'M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6' }]],
  eye: [['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  fingerprint: [['path', { d: 'M12 4a7 7 0 0 0-7 7v3M12 8a3 3 0 0 0-3 3v3a8 8 0 0 0 2 5M12 12v3a11 11 0 0 0 2 6M16 10a4 4 0 0 0-4-4M19 12a7 7 0 0 0-2-5M8 14v1' }]],
  bolt: [['path', { d: 'M13 2L4 14h7l-1 8 9-12h-7z' }]],
  phone: [['rect', { x: 7, y: 2, width: 10, height: 20, rx: 2 }], ['path', { d: 'M11 18h2' }]],
  camera: [['path', { d: 'M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['circle', { cx: 12, cy: 13, r: 3.5 }]],
  image: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 1.5 }], ['path', { d: 'M21 17l-5-5-9 8' }]],
  help: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.5' }]],
  download: [['path', { d: 'M12 3v12M7 10l5 5 5-5M4 20h16' }]],
  chart: [['path', { d: 'M4 20V4M4 20h16' }], ['rect', { x: 7, y: 12, width: 3, height: 5 }], ['rect', { x: 12, y: 8, width: 3, height: 9 }], ['rect', { x: 17, y: 5, width: 3, height: 12 }]],
  drop: [['path', { d: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z' }]],
  tv: [['rect', { x: 3, y: 5, width: 18, height: 12, rx: 2 }], ['path', { d: 'M8 21h8M12 17v4' }]],
  bulb: [['path', { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z' }]],
};

export function icon(name, size = 24) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const [tag, attrs] of P[name] || P.help) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
  }
  return svg;
}
