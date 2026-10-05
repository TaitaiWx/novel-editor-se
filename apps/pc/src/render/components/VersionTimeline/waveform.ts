/**
 * 在 canvas 上绘制音频波形
 */
export const drawWaveform = (canvas: HTMLCanvasElement, audioBuffer: AudioBuffer) => {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const channelData = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channelData.length / width));
  const centerY = height / 2;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#11161c';
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#569cd6');
  gradient.addColorStop(1, '#4ec9b0');

  context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(width, centerY);
  context.stroke();

  context.fillStyle = gradient;
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * step;
    const end = Math.min(start + step, channelData.length);
    for (let index = start; index < end; index += 1) {
      const sample = channelData[index];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    const amplitude = Math.max(Math.abs(min), Math.abs(max));
    const barHeight = Math.max(2, amplitude * (height - 20));
    context.fillRect(x, centerY - barHeight / 2, 1, barHeight);
  }
};
