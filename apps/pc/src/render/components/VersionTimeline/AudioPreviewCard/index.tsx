/**
 * AudioPreviewCard — 音频版本预览卡片（波形 + 播放器 + 元信息）
 */
import React, { useState, useEffect, useRef } from 'react';
import { drawWaveform } from '../waveform';
import { formatByteSize, formatDuration } from '../utils';
import styles from './styles.module.scss';

export interface AudioPreviewCardProps {
  title: string;
  dataUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  emptyText: string;
}

const AudioPreviewCard: React.FC<AudioPreviewCardProps> = ({
  title,
  dataUrl,
  mimeType,
  byteSize,
  emptyText,
}) => {
  const [duration, setDuration] = useState<number | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [channels, setChannels] = useState<number | null>(null);
  const [bitrateKbps, setBitrateKbps] = useState<number | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let audioContext: AudioContext | null = null;

    const analyzeAudio = async () => {
      if (!dataUrl) {
        setDuration(null);
        setSampleRate(null);
        setChannels(null);
        setBitrateKbps(null);
        return;
      }

      try {
        const response = await fetch(dataUrl);
        const arrayBuffer = await response.arrayBuffer();
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) {
          return;
        }

        audioContext = new AudioContextCtor();
        const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

        if (disposed) {
          return;
        }

        setDuration(decoded.duration);
        setSampleRate(decoded.sampleRate);
        setChannels(decoded.numberOfChannels);
        if (byteSize && decoded.duration > 0) {
          setBitrateKbps(Math.round((byteSize * 8) / decoded.duration / 1000));
        } else {
          setBitrateKbps(null);
        }

        if (waveformCanvasRef.current) {
          drawWaveform(waveformCanvasRef.current, decoded);
        }
      } catch {
        if (!disposed) {
          setSampleRate(null);
          setChannels(null);
          setBitrateKbps(null);
        }
      } finally {
        if (audioContext) {
          void audioContext.close();
        }
      }
    };

    void analyzeAudio();

    return () => {
      disposed = true;
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };
  }, [byteSize, dataUrl]);

  return (
    <div className={styles.audioComparePane}>
      <div className={styles.audioCompareLabel}>{title}</div>
      {dataUrl ? (
        <>
          <canvas
            ref={waveformCanvasRef}
            className={styles.waveformCanvas}
            width={560}
            height={144}
          />
          <audio
            className={styles.audioPlayer}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              setDuration(
                Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null
              );
            }}
          >
            <source src={dataUrl} type={mimeType ?? undefined} />
          </audio>
          <div className={styles.audioMetaGrid}>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>格式</span>
              <span className={styles.audioMetaValue}>{mimeType ?? '未知'}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>大小</span>
              <span className={styles.audioMetaValue}>{formatByteSize(byteSize)}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>时长</span>
              <span className={styles.audioMetaValue}>{formatDuration(duration)}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>采样率</span>
              <span className={styles.audioMetaValue}>
                {sampleRate ? `${Math.round(sampleRate)} Hz` : '读取中'}
              </span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>声道</span>
              <span className={styles.audioMetaValue}>
                {channels ? `${channels} 声道` : '读取中'}
              </span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>估算码率</span>
              <span className={styles.audioMetaValue}>
                {bitrateKbps ? `${bitrateKbps} kbps` : '读取中'}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.previewPlaceholder}>{emptyText}</div>
      )}
    </div>
  );
};

export default AudioPreviewCard;
