import React, {useEffect, useMemo, useRef, useState} from 'react';
import {NativeModules, StyleSheet, View} from 'react-native';
import RNFS from 'react-native-fs';
import Svg, {G, Line, Path, Polygon} from 'react-native-svg';
import publishedSigns from '../../assets/motions/published_signs.json';
import {AvatarClip} from './SkeletalAvatar';

type Point = [number, number, number];
type MotionFrame = {bodyHands: Point[]; face: Point[]};
type Motion = {fps: number; frames: MotionFrame[]};
type ArmBinding = {shoulder: number; elbow: number; wrist: number; hip: number; handStart?: number};
type ScreenPoint = {x: number; y: number};

type Props = {
  clip: AvatarClip;
  playbackId: number;
  onClipEnd: () => void;
};

const VIEW_WIDTH = 562;
const VIEW_HEIGHT = 1000;
const RETURN_TO_REST_MS = 420;
const SIGN_TRANSITION_MS = 180;
const MIN_SIGN_PLAYBACK_SECONDS = 1.35;

const BODY_SEGMENTS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const HAND_SEGMENTS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15],
  [15, 16], [0, 17], [17, 18], [18, 19], [19, 20],
];
const ARMS: ArmBinding[] = [
  {shoulder: 11, elbow: 13, wrist: 15, hip: 23},
  {shoulder: 12, elbow: 14, wrist: 16, hip: 24},
];
const MAJOR_JOINTS = [11, 13, 15, 12, 14, 16, 23, 25, 27, 24, 26, 28];
const EXPRESSION_LANDMARKS = [
  33, 133, 159, 145, 263, 362, 386, 374,
  70, 105, 107, 336, 334, 300,
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
  78, 95, 88, 178, 87, 13, 14, 317, 402, 318, 324, 308, 415,
];

const motionCache = new Map<string, Motion>();
const pictureInPictureDiagnostics = NativeModules.VozualPictureInPicture as {
  reportPlaybackEvent?: (event: string, publishedGloss: string) => void;
} | undefined;

function valid(point: Point | undefined): point is Point {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

function copyPoint(point: Point): Point {
  return [point[0], point[1], point[2]];
}

function mixPoint(start: Point, end: Point, amount: number): Point {
  if (!valid(start)) return copyPoint(end);
  if (!valid(end)) return copyPoint(start);
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function mixFrame(start: MotionFrame, end: MotionFrame, amount: number): MotionFrame {
  const bodyLength = Math.max(start.bodyHands.length, end.bodyHands.length);
  const faceLength = Math.max(start.face.length, end.face.length);
  return {
    bodyHands: Array.from({length: bodyLength}, (_, index) => {
      const startPoint = start.bodyHands[index] ?? end.bodyHands[index] ?? [0, 0, 0];
      const endPoint = end.bodyHands[index] ?? startPoint;
      return mixPoint(startPoint, endPoint, amount);
    }),
    face: Array.from({length: faceLength}, (_, index) => {
      const startPoint = start.face[index] ?? end.face[index] ?? [0, 0, 0];
      const endPoint = end.face[index] ?? startPoint;
      return mixPoint(startPoint, endPoint, amount);
    }),
  };
}

function rangeFor(points: Point[]) {
  const usable = points.filter(valid);
  if (usable.length === 0) return undefined;
  return {
    minX: Math.min(...usable.map(point => point[0])),
    maxX: Math.max(...usable.map(point => point[0])),
    minY: Math.min(...usable.map(point => point[1])),
    maxY: Math.max(...usable.map(point => point[1])),
  };
}

function retargetMotion(motion: Motion): Motion {
  const reference = motion.frames[0];
  const leftShoulder = reference?.bodyHands[11];
  const rightShoulder = reference?.bodyHands[12];
  const leftHip = reference?.bodyHands[23];
  const rightHip = reference?.bodyHands[24];
  if (!reference || !valid(leftShoulder) || !valid(rightShoulder) || !valid(leftHip) || !valid(rightHip)) {
    return motion;
  }
  const shoulderCenter: Point = [
    (leftShoulder[0] + rightShoulder[0]) / 2,
    (leftShoulder[1] + rightShoulder[1]) / 2,
    0,
  ];
  const hipY = (leftHip[1] + rightHip[1]) / 2;
  const bodyScaleX = 0.42 / Math.max(0.001, Math.abs(leftShoulder[0] - rightShoulder[0]));
  const bodyScaleY = 0.47 / Math.max(0.001, Math.abs(hipY - shoulderCenter[1]));
  const faceBounds = rangeFor(reference.face);
  const faceCenter = faceBounds
    ? [(faceBounds.minX + faceBounds.maxX) / 2, (faceBounds.minY + faceBounds.maxY) / 2] as const
    : undefined;
  const faceScaleX = faceBounds ? 0.22 / Math.max(0.001, faceBounds.maxX - faceBounds.minX) : 1;
  const faceScaleY = faceBounds ? 0.30 / Math.max(0.001, faceBounds.maxY - faceBounds.minY) : 1;
  const retargetBody = (point: Point): Point => !valid(point) ? point : [
    0.5 + (point[0] - shoulderCenter[0]) * bodyScaleX,
    0.68 + (point[1] - shoulderCenter[1]) * bodyScaleY,
    point[2],
  ];
  const retargetFace = (point: Point): Point => !valid(point) || !faceCenter ? point : [
    0.5 + (point[0] - faceCenter[0]) * faceScaleX,
    0.39 + (point[1] - faceCenter[1]) * faceScaleY,
    point[2],
  ];
  return {
    fps: motion.fps,
    frames: motion.frames.map(frame => ({
      bodyHands: frame.bodyHands.map(retargetBody),
      face: frame.face.map(retargetFace),
    })),
  };
}

async function loadMotion(clip: string): Promise<Motion> {
  const key = clip.trim().toUpperCase();
  const cached = motionCache.get(key);
  if (cached) return cached;
  const filename = `${clip.trim().toLowerCase()}.motion.json`;
  const content = await RNFS.readFileAssets(`avatar/motions/${filename}`, 'utf8');
  const parsed = JSON.parse(content) as Motion;
  if (!Array.isArray(parsed.frames) || parsed.frames.length < 2) {
    throw new Error(`Motion ${clip} does not contain enough frames.`);
  }
  const motion = retargetMotion(parsed);
  motionCache.set(key, motion);
  return motion;
}

function squaredDistance(first: Point, second: Point): number {
  return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
}

function bindHandsToArms(frame: MotionFrame): ArmBinding[] {
  const bindings: ArmBinding[] = ARMS.map(arm => ({...arm}));
  const firstHand = frame.bodyHands[33];
  const secondHand = frame.bodyHands[54];
  const firstWrist = frame.bodyHands[15];
  const secondWrist = frame.bodyHands[16];
  const hasFirst = valid(firstHand);
  const hasSecond = valid(secondHand);
  if (hasFirst && hasSecond && valid(firstWrist) && valid(secondWrist)) {
    const direct = squaredDistance(firstHand, firstWrist) + squaredDistance(secondHand, secondWrist);
    const crossed = squaredDistance(firstHand, secondWrist) + squaredDistance(secondHand, firstWrist);
    bindings[0].handStart = direct <= crossed ? 33 : 54;
    bindings[1].handStart = direct <= crossed ? 54 : 33;
  } else if ((hasFirst || hasSecond) && valid(firstWrist) && valid(secondWrist)) {
    const handStart = hasFirst ? 33 : 54;
    const hand = frame.bodyHands[handStart];
    bindings[squaredDistance(hand, firstWrist) <= squaredDistance(hand, secondWrist) ? 0 : 1].handStart = handStart;
  }
  return bindings;
}

function bindingsForMotion(motion: Motion): ArmBinding[] {
  const bindings: ArmBinding[] = ARMS.map(arm => ({...arm}));
  for (const frame of motion.frames) {
    bindHandsToArms(frame).forEach((binding, index) => {
      if (bindings[index].handStart === undefined && binding.handStart !== undefined) {
        bindings[index].handStart = binding.handStart;
      }
    });
    if (bindings.every(binding => binding.handStart !== undefined)) break;
  }
  return bindings;
}

function neutralBindings(): ArmBinding[] {
  return ARMS.map((arm, index) => ({...arm, handStart: index === 0 ? 33 : 54}));
}

function neutralHand(wrist: Point, outward: number): Point[] {
  const point = (x: number, y: number): Point => [wrist[0] + x, wrist[1] + y, wrist[2]];
  const fingers: Point[] = [copyPoint(wrist)];
  fingers.push(point(outward * 0.040, 0.012), point(outward * 0.068, 0.035), point(outward * 0.080, 0.061), point(outward * 0.088, 0.083));
  const columns = [-0.044, -0.015, 0.015, 0.044];
  const lengths = [0.090, 0.120, 0.114, 0.095];
  columns.forEach((column, index) => {
    const length = lengths[index];
    fingers.push(point(column, 0.022), point(column, length * 0.48), point(column, length * 0.78), point(column, length));
  });
  return fingers;
}

function makeRestPose(frame: MotionFrame, bindings: ArmBinding[]): MotionFrame {
  const bodyHands = frame.bodyHands.map(copyPoint);
  const face = frame.face.map(copyPoint);
  for (const side of bindings) {
    const shoulder = bodyHands[side.shoulder];
    const hip = bodyHands[side.hip];
    const wrist = bodyHands[side.wrist];
    if (!valid(shoulder) || !valid(hip) || !valid(wrist)) continue;
    const restWrist: Point = [
      hip[0] + (shoulder[0] - hip[0]) * 1.12,
      shoulder[1] + (hip[1] - shoulder[1]) * 0.88,
      hip[2],
    ];
    bodyHands[side.elbow] = [
      shoulder[0] + (restWrist[0] - shoulder[0]) * 0.49,
      shoulder[1] + (restWrist[1] - shoulder[1]) * 0.49,
      shoulder[2] + (restWrist[2] - shoulder[2]) * 0.49,
    ];
    bodyHands[side.wrist] = restWrist;
    if (side.handStart !== undefined) {
      const outward = shoulder[0] >= 0.5 ? 1 : -1;
      neutralHand(restWrist, outward).forEach((point, index) => {
        bodyHands[side.handStart! + index] = point;
      });
    }
  }
  return {bodyHands, face};
}

function faceAnchor(face: Point[]): Point | undefined {
  const forehead = face[10];
  const chin = face[152];
  const leftEye = face[33];
  const rightEye = face[263];
  if (!valid(forehead) || !valid(chin) || !valid(leftEye) || !valid(rightEye)) return undefined;
  return [(leftEye[0] + rightEye[0]) / 2, (forehead[1] + chin[1]) / 2, (forehead[2] + chin[2]) / 2];
}

function project(point: Point): ScreenPoint {
  return {
    x: VIEW_WIDTH / 2 + (point[0] - 0.5) * VIEW_WIDTH * 1.49,
    y: VIEW_HEIGHT * (0.022 + point[1] * 0.838),
  };
}

function projectFace(point: Point, anchor: Point | undefined): ScreenPoint | undefined {
  if (!valid(point) || !anchor) return undefined;
  return project([
    anchor[0] + (point[0] - anchor[0]) * 1.05,
    anchor[1] + (point[1] - anchor[1]) * 1.18,
    point[2],
  ]);
}

function circlePath(points: Array<ScreenPoint | undefined>, radius: number): string {
  return points.filter((point): point is ScreenPoint => point != null).map(point =>
    `M${point.x - radius},${point.y}a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 -${radius * 2},0`,
  ).join('');
}

function frameSegments(bindings: ArmBinding[]): Array<[number, number]> {
  const segments = [...BODY_SEGMENTS];
  bindings.forEach(binding => {
    if (binding.handStart === undefined) return;
    segments.push([binding.wrist, binding.handStart]);
    HAND_SEGMENTS.forEach(([start, end]) => segments.push([binding.handStart! + start, binding.handStart! + end]));
  });
  return segments;
}

export function PipSkeletalAvatar({clip, playbackId, onClipEnd}: Props) {
  const [frame, setFrame] = useState<MotionFrame>();
  const [ready, setReady] = useState(false);
  const displayedFrame = useRef<MotionFrame>();
  const restReference = useRef<MotionFrame>();
  const bindings = useRef<ArmBinding[]>(neutralBindings());
  const animation = useRef<number>();

  const display = (nextFrame: MotionFrame) => {
    displayedFrame.current = nextFrame;
    setFrame(nextFrame);
  };

  useEffect(() => {
    let cancelled = false;
    const firstPublished = publishedSigns.publishedGlosses[0];
    if (!firstPublished) return undefined;
    loadMotion(firstPublished).then(motion => {
      if (cancelled) return;
      const initialBindings = bindingsForMotion(motion);
      bindings.current = initialBindings;
      restReference.current = motion.frames[0];
      display(makeRestPose(motion.frames[0], initialBindings));
      setReady(true);
    }).catch(error => console.error('[PiP skeleton] Could not load the rest pose.', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    if (animation.current !== undefined) cancelAnimationFrame(animation.current);

    const animateTransition = (start: MotionFrame, target: MotionFrame, duration: number, complete?: () => void) => {
      const startedAt = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - startedAt) / duration);
        const smooth = progress * progress * (3 - 2 * progress);
        display(mixFrame(start, target, smooth));
        if (progress < 1) animation.current = requestAnimationFrame(tick);
        else complete?.();
      };
      animation.current = requestAnimationFrame(tick);
    };

    if (clip === 'IDLE') {
      const current = displayedFrame.current;
      const reference = restReference.current ?? current;
      if (current && reference) {
        bindings.current = neutralBindings();
        animateTransition(current, makeRestPose(reference, bindings.current), RETURN_TO_REST_MS);
      }
      return () => {
        cancelled = true;
        if (animation.current !== undefined) cancelAnimationFrame(animation.current);
      };
    }

    loadMotion(clip).then(motion => {
      if (cancelled) return;
      pictureInPictureDiagnostics?.reportPlaybackEvent?.('motion-loaded', clip);
      bindings.current = bindingsForMotion(motion);
      restReference.current = motion.frames[0];
      const play = () => {
        const startedAt = performance.now();
        const playbackFps = Math.min(
          Math.max(1, motion.fps),
          Math.max(1, (motion.frames.length - 1) / MIN_SIGN_PLAYBACK_SECONDS),
        );
        let lastFrame = -1;
        const tick = (now: number) => {
          if (cancelled) return;
          const index = Math.min(motion.frames.length - 1, Math.floor(((now - startedAt) / 1000) * playbackFps));
          if (index !== lastFrame) {
            display(motion.frames[index]);
            lastFrame = index;
          }
          if (index < motion.frames.length - 1) animation.current = requestAnimationFrame(tick);
          else onClipEnd();
        };
        animation.current = requestAnimationFrame(tick);
      };
      const current = displayedFrame.current;
      if (current) animateTransition(current, motion.frames[0], SIGN_TRANSITION_MS, play);
      else {
        display(motion.frames[0]);
        play();
      }
    }).catch(error => {
      pictureInPictureDiagnostics?.reportPlaybackEvent?.('motion-load-failed', clip);
      console.error(`[PiP skeleton] Could not load ${clip}.`, error);
      if (!cancelled) onClipEnd();
    });

    return () => {
      cancelled = true;
      if (animation.current !== undefined) cancelAnimationFrame(animation.current);
    };
  }, [clip, onClipEnd, playbackId, ready]);

  const drawing = useMemo(() => {
    if (!frame) return undefined;
    const bodyHands = frame.bodyHands;
    const anchor = faceAnchor(frame.face);
    const projected = bodyHands.map(point => valid(point) ? project(point) : undefined);
    const face = frame.face.map(point => projectFace(point, anchor));
    const expression = EXPRESSION_LANDMARKS.map(index => projectFace(frame.face[index], anchor));
    const torsoIndexes = [11, 12, 24, 23];
    const torso = torsoIndexes.map(index => projected[index]).filter((point): point is ScreenPoint => point != null);
    const segments = frameSegments(bindings.current);
    const visibleHandStarts = bindings.current.flatMap(binding => binding.handStart === undefined ? [] : [binding.handStart]);
    const joints = [
      ...MAJOR_JOINTS.map(index => projected[index]),
      ...visibleHandStarts.flatMap(start => Array.from({length: 21}, (_, index) => projected[start + index])),
    ];
    const shoulderCenter = projected[11] && projected[12] ? {
      x: (projected[11]!.x + projected[12]!.x) / 2,
      y: (projected[11]!.y + projected[12]!.y) / 2,
    } : undefined;
    const chin = face[152];
    return {projected, face, expression, torso, segments, joints, shoulderCenter, chin};
  }, [frame]);

  return (
    <View style={styles.container} accessibilityLabel="Esqueleto capturado de VOZUAL en ventana flotante">
      {drawing && <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet">
        <G>
          {drawing.torso.length === 4 && <Polygon
            points={drawing.torso.map(point => `${point.x},${point.y}`).join(' ')}
            fill="#354B62"
            fillOpacity={0.82}
            stroke="#A5FFF9"
            strokeWidth={2}
          />}
          {ARMS.flatMap((arm, index) => [[arm.shoulder, arm.elbow], [arm.elbow, arm.wrist]].map(([start, end], segment) => {
            const from = drawing.projected[start];
            const to = drawing.projected[end];
            return from && to ? <Line
              key={`limb-${index}-${segment}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#7899BA" strokeWidth={34} strokeLinecap="round"
            /> : null;
          }))}
          {drawing.shoulderCenter && drawing.chin && <Line
            x1={drawing.shoulderCenter.x} y1={drawing.shoulderCenter.y}
            x2={drawing.chin.x} y2={drawing.chin.y}
            stroke="#7899BA" strokeWidth={22} strokeLinecap="round"
          />}
        </G>
        <G>
          {drawing.segments.map(([start, end], index) => {
            const from = drawing.projected[start];
            const to = drawing.projected[end];
            return from && to ? <Line
              key={`segment-${index}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#A5FFF9" strokeWidth={3.5} strokeLinecap="round"
            /> : null;
          })}
          <Path d={circlePath(drawing.joints, 4.2)} fill="#FFFFFF" />
          <Path d={circlePath(drawing.face, 2.5)} fill="#FFFFFF" />
          <Path d={circlePath(drawing.expression, 4.8)} fill="#8CFFF8" />
          <Path d={circlePath(MAJOR_JOINTS.map(index => drawing.projected[index]), 5.2)} fill="#6BE3DC" />
        </G>
      </Svg>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignSelf: 'stretch', backgroundColor: '#202A38'},
});
