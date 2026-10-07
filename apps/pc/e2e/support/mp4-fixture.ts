/**
 * 在测试中生成一个很小但真实可解码的 MP4（H.264 Baseline，16×16，I_PCM 宏块）。
 *
 * 不依赖 ffmpeg / 编码器：I_PCM 宏块直接携带原始像素，码流可以手工拼出
 * （SPS + PPS + 每帧一个 IDR 切片），再用 mp4-muxer（@novel-editor/video 的依赖）封装成 MP4。
 */
import { createRequire } from 'node:module';

interface ArrayBufferTargetLike {
  buffer: ArrayBuffer;
}

interface Mp4MuxerModule {
  ArrayBufferTarget: new () => ArrayBufferTargetLike;
  Muxer: new (options: {
    target: ArrayBufferTargetLike;
    video: { codec: 'avc'; width: number; height: number };
    fastStart: 'in-memory';
  }) => {
    addVideoChunkRaw(
      data: Uint8Array,
      type: 'key' | 'delta',
      timestamp: number,
      duration: number,
      meta?: {
        decoderConfig: {
          codec: string;
          codedWidth: number;
          codedHeight: number;
          description: Uint8Array;
        };
      }
    ): void;
    finalize(): void;
  };
}

// mp4-muxer 是 @novel-editor/video 的依赖，从该包解析，避免依赖 pnpm 的提升行为
const requireFromVideo = createRequire(
  new URL('../../../../packages/video/package.json', import.meta.url)
);

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  bit(value: number): void {
    this.current = (this.current << 1) | (value & 1);
    this.bitCount += 1;
    if (this.bitCount === 8) {
      this.bytes.push(this.current);
      this.current = 0;
      this.bitCount = 0;
    }
  }

  bits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i -= 1) this.bit((value >> i) & 1);
  }

  /** 无符号指数哥伦布编码 ue(v) */
  ue(value: number): void {
    const code = value + 1;
    const length = Math.floor(Math.log2(code));
    this.bits(0, length);
    this.bits(code, length + 1);
  }

  /** 有符号指数哥伦布编码 se(v) */
  se(value: number): void {
    this.ue(value <= 0 ? -2 * value : 2 * value - 1);
  }

  alignZero(): void {
    while (this.bitCount !== 0) this.bit(0);
  }

  byte(value: number): void {
    this.bits(value, 8);
  }

  /** rbsp_trailing_bits：停止位 1 + 补零对齐 */
  trailing(): Uint8Array {
    this.bit(1);
    this.alignZero();
    return Uint8Array.from(this.bytes);
  }
}

/** 加防竞争字节（00 00 0x → 00 00 03 0x）并加上 NAL 头 */
function nal(header: number, rbsp: Uint8Array): Uint8Array {
  const out: number[] = [header];
  let zeros = 0;
  for (const value of rbsp) {
    if (zeros >= 2 && value <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

function sps(): Uint8Array {
  const w = new BitWriter();
  w.byte(66); // profile_idc: Baseline
  w.byte(0xc0); // constraint_set0/1
  w.byte(10); // level_idc 1.0
  w.ue(0); // seq_parameter_set_id
  w.ue(0); // log2_max_frame_num_minus4
  w.ue(2); // pic_order_cnt_type
  w.ue(1); // max_num_ref_frames
  w.bit(0); // gaps_in_frame_num_value_allowed_flag
  w.ue(0); // pic_width_in_mbs_minus1 → 16px
  w.ue(0); // pic_height_in_map_units_minus1 → 16px
  w.bit(1); // frame_mbs_only_flag
  w.bit(1); // direct_8x8_inference_flag
  w.bit(0); // frame_cropping_flag
  w.bit(0); // vui_parameters_present_flag
  return nal(0x67, w.trailing());
}

function pps(): Uint8Array {
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.bit(0); // entropy_coding_mode_flag: CAVLC
  w.bit(0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.bit(0); // weighted_pred_flag
  w.bits(0, 2); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.bit(0); // deblocking_filter_control_present_flag
  w.bit(0); // constrained_intra_pred_flag
  w.bit(0); // redundant_pic_cnt_present_flag
  return nal(0x68, w.trailing());
}

/** 一帧 IDR：一个 I_PCM 宏块（亮度随帧变化，画面有明暗变化） */
function idrSlice(frame: number): Uint8Array {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(7); // slice_type: I（整帧）
  w.ue(0); // pic_parameter_set_id
  w.bits(0, 4); // frame_num（log2_max_frame_num = 4）
  w.ue(frame % 2); // idr_pic_id：相邻 IDR 必须不同
  w.bit(0); // no_output_of_prior_pics_flag
  w.bit(0); // long_term_reference_flag
  w.se(0); // slice_qp_delta
  w.ue(25); // mb_type: I_PCM
  w.alignZero(); // pcm_alignment_zero_bit
  const luma = 0x40 + ((frame * 12) % 0x80);
  for (let i = 0; i < 256; i += 1) w.byte(luma);
  for (let i = 0; i < 128; i += 1) w.byte(0x80);
  return nal(0x65, w.trailing());
}

function avcc(spsNal: Uint8Array, ppsNal: Uint8Array): Uint8Array {
  return Uint8Array.from([
    1,
    spsNal[1],
    spsNal[2],
    spsNal[3],
    0xff, // lengthSizeMinusOne = 3
    0xe1, // 1 个 SPS
    spsNal.length >> 8,
    spsNal.length & 0xff,
    ...spsNal,
    1, // 1 个 PPS
    ppsNal.length >> 8,
    ppsNal.length & 0xff,
    ...ppsNal,
  ]);
}

function lengthPrefixed(nalUnit: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + nalUnit.length);
  new DataView(out.buffer).setUint32(0, nalUnit.length);
  out.set(nalUnit, 4);
  return out;
}

/** 生成 MP4：默认 12 帧 × 6fps = 2 秒 */
export function createTinyMp4(frames = 12, fps = 6): Uint8Array {
  const { ArrayBufferTarget, Muxer } = requireFromVideo('mp4-muxer') as Mp4MuxerModule;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: 16, height: 16 },
    fastStart: 'in-memory',
  });
  const spsNal = sps();
  const ppsNal = pps();
  const description = avcc(spsNal, ppsNal);
  const durationUs = Math.round(1_000_000 / fps);
  for (let frame = 0; frame < frames; frame += 1) {
    muxer.addVideoChunkRaw(
      lengthPrefixed(idrSlice(frame)),
      'key',
      frame * durationUs,
      durationUs,
      frame === 0
        ? {
            decoderConfig: {
              codec: 'avc1.42C00A',
              codedWidth: 16,
              codedHeight: 16,
              description,
            },
          }
        : undefined
    );
  }
  muxer.finalize();
  return new Uint8Array(target.buffer);
}
