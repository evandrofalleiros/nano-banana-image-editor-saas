import React from 'react';

export interface AspectRatio {
  name: string;
  ratio: number;
  // FIX: Use React.ReactElement instead of JSX.Element to avoid "Cannot find namespace 'JSX'" error.
  icon: React.ReactElement;
}

const SquareIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
  </svg>
);

const PortraitIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
  </svg>
);

const StoryIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="1" width="12" height="22" rx="2" ry="2"></rect>
  </svg>
);

const LandscapeIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
  </svg>
);

const ClassicIcon = () => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect>
    </svg>
);


export const ASPECT_RATIOS: AspectRatio[] = [
  { name: 'Quadrado', ratio: 1 / 1, icon: <SquareIcon /> },
  { name: 'Retrato', ratio: 4 / 5, icon: <PortraitIcon /> },
  { name: 'Story', ratio: 9 / 16, icon: <StoryIcon /> },
  { name: 'Paisagem', ratio: 16 / 9, icon: <LandscapeIcon /> },
  { name: 'Clássico', ratio: 4 / 3, icon: <ClassicIcon /> },
];