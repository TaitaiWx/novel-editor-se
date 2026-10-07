/**
 * 预演播放：当前时间、播放 / 暂停、循环、拖动进度条。
 * 播放用 requestAnimationFrame 推进时间（只决定预览进度；导出视频逐帧采样，与播放无关）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PrevizPlayback {
  time: number;
  playing: boolean;
  loop: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  setLoop: (loop: boolean) => void;
}

export function usePrevizPlayback(duration: number): PrevizPlayback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const timeRef = useRef(0);
  timeRef.current = time;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // 时长变化（重新生成）后进度不超过新时长
  useEffect(() => {
    setTime((prev) => Math.min(prev, duration));
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const delta = last === null ? 0 : (now - last) / 1000;
      last = now;
      let next = timeRef.current + delta;
      if (next >= duration) {
        if (loopRef.current) {
          next = duration > 0 ? next % duration : 0;
        } else {
          setTime(duration);
          setPlaying(false);
          return;
        }
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing]);

  const play = useCallback(() => {
    // 播放到末尾后再点播放：从头开始
    if (timeRef.current >= duration) setTime(0);
    setPlaying(true);
  }, [duration]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);
  const seek = useCallback(
    (next: number) => setTime(Math.max(0, Math.min(duration, Number.isFinite(next) ? next : 0))),
    [duration]
  );

  return { time, playing, loop, play, pause, toggle, seek, setLoop };
}
