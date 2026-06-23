import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from 'react-native-svg';

interface Props {
  size?: number;
}

/**
 * ManoSpeak brand icon.
 * B-handshape (palm facing viewer) with a vertical sky-blue gradient.
 * Three right-pointing cubic bezier arcs represent speech/TTS output.
 * Transparent background — designed for dark surfaces.
 */
export const ManoSpeakIcon: React.FC<Props> = ({ size = 44 }) => {
  const w = Math.round((60 / 44) * size);

  return (
    <Svg width={w} height={size} viewBox="0 0 60 44">
      <Defs>
        {/* Sky-blue → ocean-blue top-to-bottom gradient for hand */}
        <LinearGradient id="handGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7DD3FC" />
          <Stop offset="1" stopColor="#0284C7" />
        </LinearGradient>
      </Defs>

      {/* ── Hand (B-handshape, all fingers extended) ── */}
      {/* Thumb — angled left via rotation */}
      <Rect
        x="0" y="25" width="10" height="9" rx="4.5"
        fill="url(#handGrad)"
        transform="rotate(-18, 5, 30)"
      />
      {/* Index finger */}
      <Rect x="5"  y="2" width="7"   height="22" rx="3.5"  fill="url(#handGrad)" />
      {/* Middle finger (tallest) */}
      <Rect x="13" y="0" width="7"   height="24" rx="3.5"  fill="url(#handGrad)" />
      {/* Ring finger */}
      <Rect x="21" y="2" width="7"   height="22" rx="3.5"  fill="url(#handGrad)" />
      {/* Pinky */}
      <Rect x="29" y="6" width="5.5" height="18" rx="2.75" fill="url(#handGrad)" />
      {/* Palm */}
      <Rect x="3"  y="22" width="33" height="20" rx="7"    fill="url(#handGrad)" />

      {/* ── Speech / TTS waves (cubic-bezier right-pointing curves) ── */}
      <Path
        d="M 38 16 C 46 16 46 28 38 28"
        stroke="#34D399" strokeWidth="3" fill="none" strokeLinecap="round"
      />
      <Path
        d="M 42 12 C 53 12 53 32 42 32"
        stroke="#10B981" strokeWidth="2.5" fill="none" strokeLinecap="round"
        opacity={0.75}
      />
      <Path
        d="M 46 8 C 58 8 58 36 46 36"
        stroke="#059669" strokeWidth="2" fill="none" strokeLinecap="round"
        opacity={0.5}
      />
    </Svg>
  );
};
