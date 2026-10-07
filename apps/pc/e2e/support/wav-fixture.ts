/**
 * 在测试中生成一个很小但真实可解码的 WAV（16-bit 单声道 PCM 正弦音），用作 mock 配音 / 背景音乐
 */
export function createTinyWav(durationSec = 0.6, frequency = 440, sampleRate = 16000): Uint8Array {
  const samples = Math.round(durationSec * sampleRate);
  const dataSize = samples * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.3;
    view.setInt16(44 + index * 2, Math.round(value * 32767), true);
  }
  return bytes;
}
