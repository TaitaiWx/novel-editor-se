/**
 * 在 Electron 隐藏窗口里把逐帧画面（+ 可选的单声道声音）编码为 MP4（H.264 + AAC，mp4-muxer 封装）。
 * 依赖 window.Mp4Muxer 与 audio.js 的 window.SampleAudio。见 ../generate-sample-media.mjs。
 */
(function () {
  'use strict';

  /**
   * @param {number} width
   * @param {number} height
   * @param {number | undefined} bitrate
   * @param {number} fps
   */
  async function pickCodec(width, height, bitrate, fps) {
    // 优先 High（CABAC，平涂插画同样码率下更清晰），不支持时退回 Main / Baseline
    for (const codec of ['avc1.640028', 'avc1.4D401F', 'avc1.42E01F']) {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (support.supported) return codec;
    }
    throw new Error('当前 Electron 不支持 H.264 编码');
  }

  /**
   * options: { width, height, fps, frames, bitrate?, bitrateMode?, quantizer?, keyFrame?(index), draw(canvas, index),
   *            audio?: Float32Array, audioBitrate? }
   * 给了 quantizer（H.264 QP，0–51，越小越清楚）时按固定画质编码；否则按目标码率（默认 variable）
   * 返回 base64
   */
  /**
   * @param {SampleEncodeOptions} options
   */
  async function encodeMp4(options) {
    const { width, height, fps, frames, bitrate, draw, audio } = options;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: 'avc', width, height, frameRate: fps },
      ...(audio
        ? { audio: { codec: 'aac', numberOfChannels: 1, sampleRate: SampleAudio.SR } }
        : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    /** @type {DOMException | null} */
    let failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        failure = error;
      },
    });
    const codec = await pickCodec(width, height, bitrate, fps);
    // quantizer：每帧固定量化参数（画质恒定，静止画面的 P 帧几乎为零字节）；否则按目标码率
    const quantizer = options.quantizer;
    encoder.configure(
      quantizer
        ? { codec, width, height, bitrateMode: 'quantizer', framerate: fps, avc: { format: 'avc' } }
        : {
            codec,
            width,
            height,
            bitrate,
            bitrateMode: options.bitrateMode || 'variable',
            framerate: fps,
            avc: { format: 'avc' },
          }
    );
    for (let i = 0; i < frames; i += 1) {
      draw(canvas, i);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      const keyFrame = options.keyFrame ? options.keyFrame(i) : i % (fps * 4) === 0;
      encoder.encode(frame, quantizer ? { keyFrame, avc: { quantizer } } : { keyFrame });
      frame.close();
      if (encoder.encodeQueueSize > 8) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    if (audio) {
      await SampleAudio.feedAudio(
        audio,
        (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        options.audioBitrate || 48000
      );
    }
    muxer.finalize();
    return SampleAudio.toBase64(new Uint8Array(target.buffer));
  }

  window.SampleEncode = { encodeMp4 };
})();
