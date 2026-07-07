// Shared wheel rendering: the marketing preview and the public spin page draw
// the exact same SVG, so what marketing sees is what the customer gets.

const SLICE_COLORS = [
  '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#e11d48'
];
const TOP_COLOR = '#fbbf24';

const polar = (cx, cy, r, angleDeg) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

const slicePath = (cx, cy, r, startAngle, endAngle) => {
  const [x1, y1] = polar(cx, cy, r, startAngle);
  const [x2, y2] = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
};

// Wraps long prize text into up to 3 short lines so it stays inside a slice.
const wrapSliceLabel = (label, maxLine = 12) => {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxLine) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word.length > maxLine ? `${word.slice(0, maxLine - 1)}…` : word;
    }
    if (lines.length === 3) break;
  }
  if (current && lines.length < 3) lines.push(current);
  return lines.length ? lines : ['—'];
};

export function WheelSvg({ slices, rotation = 0, gradientId = 'goldShine', className = 'wheel-svg' }) {
  const size = 460;
  const c = size / 2;
  const radius = c - 14;
  const sliceAngle = 360 / Math.max(1, slices.length);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: `rotate(${rotation}deg)` }}
      role="img"
      aria-label="Ruleta de premios"
    >
      {slices.map((slice, i) => {
        const start = i * sliceAngle;
        const end = (i + 1) * sliceAngle;
        const mid = start + sliceAngle / 2;
        const fill = slice.top ? TOP_COLOR : SLICE_COLORS[i % SLICE_COLORS.length];
        const lines = wrapSliceLabel(slice.label, slices.length > 8 ? 10 : 12);
        const [tx, ty] = polar(c, c, radius * 0.62, mid);
        // Slices on the lower half get their text flipped 180° so nothing
        // reads upside down at rest.
        const textAngle = mid > 90 && mid < 270 ? mid + 180 : mid;
        return (
          <g key={i}>
            <path d={slicePath(c, c, radius, start, end)} fill={fill} stroke="#ffffff" strokeWidth="3" />
            {slice.top && (
              <path d={slicePath(c, c, radius, start, end)} fill={`url(#${gradientId})`} stroke="#fff7e0" strokeWidth="3" />
            )}
            <text
              x={tx}
              y={ty}
              transform={`rotate(${textAngle}, ${tx}, ${ty})`}
              textAnchor="middle"
              className={`wheel-slice-text ${slice.top ? 'is-top' : ''}`}
            >
              {slice.top && <tspan x={tx} dy={-(lines.length * 8) - 10}>⭐</tspan>}
              {lines.map((line, li) => (
                <tspan key={li} x={tx} dy={li === 0 && !slice.top ? -((lines.length - 1) * 9) : 18}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#fff7cc" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#fbbf24" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#b45309" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={radius} fill="none" stroke="#1e1b4b" strokeWidth="6" opacity="0.35" />
    </svg>
  );
}
