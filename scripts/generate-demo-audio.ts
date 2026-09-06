/**
 * Generates short mono 16-bit PCM WAV files (sine waves) for the demo.
 * Run: bun run generate-demo-audio
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "demo", "audio");

interface ToneSpec {
  filename: string;
  frequencyHz: number;
  durationSec: number;
  amplitude?: number;
}

const TONES: readonly ToneSpec[] = [
  { filename: "demo-bgm.wav", frequencyHz: 440, durationSec: 2.0, amplitude: 0.25 },
  { filename: "demo-bgs.wav", frequencyHz: 220, durationSec: 1.5, amplitude: 0.2 },
  { filename: "demo-me.wav", frequencyHz: 880, durationSec: 0.8, amplitude: 0.3 },
  { filename: "demo-se.wav", frequencyHz: 660, durationSec: 0.25, amplitude: 0.35 },
  {
    filename: "demo-system-se.wav",
    frequencyHz: 550,
    durationSec: 0.2,
    amplitude: 0.35,
  },
];

function generateSineWaveWav(
  frequencyHz: number,
  durationSec: number,
  amplitude = 0.3,
  sampleRate = 44100,
): Buffer {
  const numSamples = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * bytesPerSample);
  }

  return buffer;
}

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const tone of TONES) {
  const wav = generateSineWaveWav(
    tone.frequencyHz,
    tone.durationSec,
    tone.amplitude,
  );
  const outputPath = join(OUTPUT_DIR, tone.filename);
  writeFileSync(outputPath, wav);
  console.log(
    `Wrote ${outputPath} (${tone.frequencyHz} Hz, ${tone.durationSec}s)`,
  );
}
