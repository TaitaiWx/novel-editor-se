#!/usr/bin/env node

const { spawn } = require('node:child_process');
const process = require('node:process');
/** Electron's Node entry point returns the executable, unlike its in-app declarations. */
const electronBinary = /** @type {unknown} */ (require('electron'));

const args = process.argv.slice(2);
const verbose = process.env.NOVEL_EDITOR_VERBOSE_ELECTRON === '1';

const noisePatterns = [
  /TSM AdjustCapsLockLEDForKeyTransitionHandling/,
  /error messaging the mach port for IMKCFRunLoopWakeUpReliable/,
  /SharedImageManager::ProduceOverlay: Trying to Produce a Overlay representation from a non-existent mailbox\./,
  /skia_output_device_buffer_queue\.cc:\d+\] Invalid mailbox\./,
];

/** @param {string} line */
const shouldFilterLine = (line) => {
  if (verbose || !line) return false;
  return noisePatterns.some((pattern) => pattern.test(line));
};

function main() {
  if (typeof electronBinary !== 'string') throw new Error('Electron executable path is missing');
  const child = spawn(electronBinary, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });

  /** @param {import("node:stream").Readable} stream @param {NodeJS.WritableStream} writer */
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

main();
