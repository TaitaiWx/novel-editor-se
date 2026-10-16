/**
 * AudioPreviewCard — 音频版本预览卡片（波形 + 播放器 + 元信息）
 */
import React, { useState, useEffect } from 'react';
import { AudioPlayer } from '../../VideoPlayer';
import { computePeaksChunked, PEAK_RESOLUTION } from '@novel-editor/media-player';
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
  const [waveform, setWaveform] = useState<{ source: string; peaks: number[] } | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setDuration(null);
    setSampleRate(null);
    setChannels(null);
    setBitrateKbps(null);
    setWaveform(null);
    let audioContext: AudioContext | null = null;

    const analyzeAudio = async () => {
      if (!dataUrl) return;

      try {
        const response = await fetch(dataUrl, { signal: controller.signal });
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

        const peaks = await computePeaksChunked(
          Array.from({ length: decoded.numberOfChannels }, (_, index) =>
            decoded.getChannelData(index)
          ),
          PEAK_RESOLUTION,
          { signal: controller.signal }
        );
        if (!disposed) setWaveform({ source: dataUrl, peaks });
      } catch {
        if (!disposed) {
          setSampleRate(null);
          setChannels(null);
          setBitrateKbps(null);
        }
      } finally {
        if (audioContext && audioContext.state !== 'closed') {
          void audioContext.close();
        }
      }
    };

    void analyzeAudio();

    return () => {
      disposed = true;
      controller.abort();
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
          <AudioPlayer
            key={dataUrl}
            className={styles.audioPlayer}
            src={{ src: dataUrl, mimeType: mimeType ?? undefined }}
            title={title}
            waveform={waveform?.source === dataUrl ? waveform.peaks : 'decorative'}
            onMetadata={({ duration }) => setDuration(Number.isFinite(duration) ? duration : null)}
          />
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
