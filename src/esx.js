// ESX-1 layout helpers. The fixed prefix ends at 0x250000; sample audio offsets
// in the headers are relative to the beginning of the sample-data section.
const ESX = {
  sampleDataAt: 0x250000, monoHeadersAt: 0x1b0100, stereoHeadersAt: 0x1b2900,
  monoCount: 256, stereoCount: 128, monoHeaderSize: 40, stereoHeaderSize: 44,
  maxSampleData: 25_165_824
};

function viewOf(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function readName(bytes, at) { return new TextDecoder('latin1').decode(bytes.subarray(at, at + 8)).replace(/\0.*$/s, '').trim() || 'Untitled sample'; }
function writeName(bytes, at, name) {
  bytes.fill(0, at, at + 8);
  const clean = String(name || 'Sample').replace(/[^\x20-\x7e]/g, '_').slice(0, 8);
  bytes.set(new TextEncoder().encode(clean), at);
}
function pcmAsWav(channels, sampleRate) {
  const frames = channels[0].length;
  const count = channels.length;
  const wav = new Uint8Array(44 + frames * count * 2);
  const dv = viewOf(wav);
  wav.set(new TextEncoder().encode('RIFF'), 0); dv.setUint32(4, wav.length - 8, true);
  wav.set(new TextEncoder().encode('WAVEfmt '), 8); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, count, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * count * 2, true);
  dv.setUint16(32, count * 2, true); dv.setUint16(34, 16, true); wav.set(new TextEncoder().encode('data'), 36); dv.setUint32(40, wav.length - 44, true);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) { dv.setInt16(p, channels[c][i], true); p += 2; }
  return wav;
}
function emptyOffset(x) { return x === 0xffffffff || x === 0; }
function decodeChannel(section, start, end) {
  if (start < 0 || end <= start || end > section.length || end - start < 18) return null;
  const payload = section.subarray(start + 16, end);
  if (payload.length < 2) return null;
  const frames = payload.length >>> 1;
  const pcm = new Int16Array(frames);
  const dataView = viewOf(payload);
  // ESX stores each signed PCM frame big-endian; WAV and Web Audio use LE/native values.
  for (let i = 0; i < frames; i++) pcm[i] = dataView.getInt16(i * 2, false);
  return pcm;
}

function parseEsx(input, fileName = 'Untitled.esx') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < ESX.sampleDataAt || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'KORG') throw new Error('This file does not have a valid ESX header.');
  const dv = viewOf(bytes);
  const section = bytes.subarray(ESX.sampleDataAt);
  const samples = [];
  for (let i = 0; i < ESX.monoCount + ESX.stereoCount; i++) {
    const stereo = i >= ESX.monoCount;
    const index = stereo ? i - ESX.monoCount : i;
    const at = (stereo ? ESX.stereoHeadersAt : ESX.monoHeadersAt) + index * (stereo ? ESX.stereoHeaderSize : ESX.monoHeaderSize);
    const a = dv.getUint32(at + 8, false), b = dv.getUint32(at + 12, false);
    const c = stereo ? dv.getUint32(at + 16, false) : 0xffffffff;
    const d = stereo ? dv.getUint32(at + 20, false) : 0xffffffff;
    if (emptyOffset(a) || emptyOffset(b) || b <= a || b > section.length || (stereo && (emptyOffset(c) || emptyOffset(d) || d <= c || d > section.length))) continue;
    const left = decodeChannel(section, a, b), right = stereo ? decodeChannel(section, c, d) : null;
    if (!left || (stereo && !right)) continue;
    samples.push({
      id: i, index: index + 1, stereo, name: readName(bytes, at), rate: dv.getUint32(at + (stereo ? 32 : 28), false) || 44100,
      frames: Math.min(left.length, right ? right.length : left.length), left, right,
      source: 'In soundbank', changed: false
    });
  }
  if (!samples.length) throw new Error('No readable samples were found in this ESX file.');
  return { bytes, fileName, samples, originalLength: bytes.length };
}

function replaceSampleFromAudio(sample, channels, sampleRate, fileName) {
  const frameCount = Math.min(...channels.map(channel => channel.length));
  if (!frameCount) throw new Error('The selected audio file contains no audio frames.');
  let left = channels[0].subarray(0, frameCount);
  let right = channels.length > 1 ? channels[1].subarray(0, frameCount) : null;
  if (!sample.stereo && right) {
    const mono = new Int16Array(frameCount);
    for (let i = 0; i < frameCount; i++) mono[i] = Math.max(-32768, Math.min(32767, (left[i] + right[i]) / 2));
    left = mono; right = null;
  } else if (sample.stereo && !right) right = left.slice();
  Object.assign(sample, { left, right, frames: frameCount, rate: sampleRate, source: fileName, changed: true });
}

function buildEsx(bank) {
  const samples = [...bank.samples].sort((a, b) => a.id - b.id);
  const parts = [];
  let cursor = 0;
  for (const sample of samples) {
    const chans = sample.stereo ? [sample.left, sample.right] : [sample.left];
    const starts = [];
    for (let ch = 0; ch < chans.length; ch++) {
      const pcm = chans[ch];
      const block = new Uint8Array(16 + pcm.length * 2);
      block.set([0x80, 0, 0x7f, 0xff]);
      const blockView = viewOf(block);
      blockView.setUint32(4, cursor, false); blockView.setUint32(8, cursor + block.length, false);
      block[12] = sample.id;
      block[13] = sample.stereo ? ch + 1 : 0; // mono, stereo channel 1, stereo channel 2
      blockView.setUint16(14, 0xffff, false);
      for (let i = 0, p = 16; i < pcm.length; i++, p += 2) blockView.setInt16(p, pcm[i], false);
      starts.push([cursor, cursor + block.length]); cursor += block.length; parts.push(block);
    }
    sample._starts = starts;
  }
  if (cursor > ESX.maxSampleData) throw new Error(`Samples require ${(cursor / 1048576).toFixed(1)} MB, above the ESX 25 MB limit.`);
  const out = new Uint8Array(ESX.sampleDataAt + cursor);
  out.set(bank.bytes.subarray(0, ESX.sampleDataAt), 0);
  let p = ESX.sampleDataAt; for (const part of parts) { out.set(part, p); p += part.length; }
  const dv = viewOf(out);
  let monoCount = 0, stereoCount = 0;
  for (let i = 0; i < ESX.monoCount; i++) out.fill(0xff, ESX.monoHeadersAt + i * ESX.monoHeaderSize + 8, ESX.monoHeadersAt + i * ESX.monoHeaderSize + 16);
  for (let i = 0; i < ESX.stereoCount; i++) out.fill(0xff, ESX.stereoHeadersAt + i * ESX.stereoHeaderSize + 8, ESX.stereoHeadersAt + i * ESX.stereoHeaderSize + 24);
  for (const sample of samples) {
    const stereo = sample.stereo, at = (stereo ? ESX.stereoHeadersAt : ESX.monoHeadersAt) + (stereo ? sample.id - ESX.monoCount : sample.id) * (stereo ? ESX.stereoHeaderSize : ESX.monoHeaderSize);
    writeName(out, at, sample.name);
    dv.setUint32(at + 8, sample._starts[0][0], false); dv.setUint32(at + 12, sample._starts[0][1], false);
    const valueAt = stereo ? at + 24 : at + 16;
    if (stereo) { dv.setUint32(at + 16, sample._starts[1][0], false); dv.setUint32(at + 20, sample._starts[1][1], false); stereoCount++; } else monoCount++;
    dv.setUint32(valueAt, 0, false); dv.setUint32(valueAt + 4, sample.frames, false); dv.setUint32(valueAt + 8, sample.rate, false);
  }
  dv.setUint32(0x1b0020, monoCount, false); dv.setUint32(0x1b0024, stereoCount, false); dv.setUint32(0x1b0028, cursor, false);
  return out;
}

function makePreviewUrl(sample) {
  const channels = sample.stereo && sample.right ? [sample.left, sample.right] : [sample.left];
  return URL.createObjectURL(new Blob([pcmAsWav(channels, sample.rate)], { type: 'audio/wav' }));
}

function decodedAudioToInt16(audioBuffer) {
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  const result = [];
  for (let c = 0; c < channelCount; c++) {
    const source = audioBuffer.getChannelData(c);
    const channel = new Int16Array(source.length);
    for (let i = 0; i < source.length; i++) channel[i] = Math.max(-32768, Math.min(32767, Math.round(source[i] * 32767)));
    result.push(channel);
  }
  return { channels: result, sampleRate: audioBuffer.sampleRate };
}

window.ESXCore = { ESX, parseEsx, replaceSampleFromAudio, buildEsx, makePreviewUrl, decodedAudioToInt16 };
