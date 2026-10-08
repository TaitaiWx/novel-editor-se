#!/usr/bin/env node

const { spawn } = require('node:child_process');
const process = require('node:process');
const electronBinary = require('electron');

const args = process.argv.slice(2);
const verbose = process.env.NOVEL_EDITOR_VERBOSE_ELECTRON === '1';

const noisePatterns = [
  /TSM AdjustCapsLockLEDForKeyTransitionHandling/,
  /error messaging the mach port for IMKCFRunLoopWakeUpReliable/,
  /SharedImageManager::ProduceOverlay: Trying to Produce a Overlay representation from a non-existent mailbox\./,
  /skia_output_device_buffer_queue\.cc:\d+\] Invalid mailbox\./,
];

const shouldFilterLine = (line) => {
  if (verbose || !line) return false;
  return noisePatterns.some((pattern) => pattern.test(line));
};

/** macOS 上用带本地化名称的 Electron 副本启动（菜单栏 / Dock 显示「小说编辑器」），失败时回退原始 Electron */
async function resolveElectronBinary() {
  if (process.env.NOVEL_EDITOR_RAW_ELECTRON === '1') return electronBinary;
  try {
    const { prepareDevElectronApp } = require('./dev-electron-app.cjs');
    return await prepareDevElectronApp(electronBinary);
  } catch (error) {
    console.warn(`[dev] 准备本地化的 Electron 副本失败，使用原始 Electron：${error.message}`);
    return electronBinary;
  }
}

async function main() {
  const binary = await resolveElectronBinary();
  const child = spawn(binary, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });

  const pipeStream = (stream, writer) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!shouldFilterLine(line)) {
          writer.write(`${line}\n`);
        }
      }
    });
    stream.on('end', () => {
      if (buffer && !shouldFilterLine(buffer)) {
        writer.write(buffer);
      }
    });
  };

  pipeStream(child.stdout, process.stdout);
  pipeStream(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

void main();
