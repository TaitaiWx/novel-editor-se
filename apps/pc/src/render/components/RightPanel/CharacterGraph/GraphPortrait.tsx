import React, { useEffect, useRef } from 'react';
import CharacterAvatar from '../../CharacterAvatar';
import type { Character } from '../types';
import styles from './styles.module.scss';

/** 动效只更新局部 CSS 变量；不让逐帧倾斜触发整个关系图重新渲染。 */
export default function GraphPortrait({
  character,
  workPath,
}: {
  character: Character;
  workPath?: string | null;
}) {
  const surface = useRef<HTMLSpanElement>(null);
  const spring = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    frame: 0,
    last: 0,
    reduced: false,
  });
  const animate = () => {
    const state = spring.current;
    if (state.frame || state.reduced) return;
    state.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - state.last) / 1000, 1 / 30);
      state.last = now;
      state.vx += ((state.tx - state.x) * 210 - state.vx * 23) * dt;
      state.vy += ((state.ty - state.y) * 210 - state.vy * 23) * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      surface.current?.style.setProperty('--tilt-x', `${state.y * -9}deg`);
      surface.current?.style.setProperty('--tilt-y', `${state.x * 9}deg`);
      surface.current?.style.setProperty('--light-x', `${50 + state.x * 38}%`);
      surface.current?.style.setProperty('--light-y', `${50 + state.y * 38}%`);
      if (
        Math.abs(state.x - state.tx) +
          Math.abs(state.y - state.ty) +
          Math.abs(state.vx) +
          Math.abs(state.vy) >
        0.003
      ) {
        state.frame = requestAnimationFrame(tick);
      } else {
        state.frame = 0;
      }
    };
    state.frame = requestAnimationFrame(tick);
  };
  const reset = () => {
    spring.current.tx = 0;
    spring.current.ty = 0;
    animate();
  };
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animationState = spring.current;
    const update = () => {
      const state = spring.current;
      state.reduced = motion.matches;
      if (state.reduced) {
        cancelAnimationFrame(state.frame);
        Object.assign(state, { frame: 0, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 });
        surface.current?.style.removeProperty('--tilt-x');
        surface.current?.style.removeProperty('--tilt-y');
      }
    };
    update();
    motion.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(animationState.frame);
      motion.removeEventListener('change', update);
    };
  }, []);
  return (
    <span
      className={styles.portraitShell}
      onPointerMove={(event) => {
        if (event.buttons || spring.current.reduced) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (!box.width || !box.height) return;
        spring.current.tx = Math.max(
          -1,
          Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1)
        );
        spring.current.ty = Math.max(
          -1,
          Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1)
        );
        animate();
      }}
      onPointerLeave={reset}
      onPointerDown={reset}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <span className={styles.portraitAura} aria-hidden="true" />
      <span ref={surface} className={styles.portraitSurface}>
        <span className={styles.portraitRing} aria-hidden="true" />
        <span className={styles.portraitCrop}>
          <CharacterAvatar
            name={character.name}
            avatar={character.avatar}
            color={character.highlightColor}
            workPath={workPath}
            size={76}
            className={styles.portraitImage}
          />
        </span>
        <span className={styles.portraitLight} aria-hidden="true" />
      </span>
    </span>
  );
}
