(() => {
const { buildEsx, decodedAudioToInt16, makePreviewUrl, parseEsx, replaceSampleFromAudio } = window.ESXCore;

const $ = (selector) => document.querySelector(selector);
const state = { bank: null, selectedId: null, filter: 'all', query: '', audio: null, previewUrl: null, toastTimer: null };
const fallbackBank = $('#fallback-bank'), fallbackAudio = $('#fallback-audio');

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.classList.remove('hidden');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.add('hidden'), 3800);
}
function formatTime(seconds) { const n = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
function formatBytes(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
function samplesMemory(samples = state.bank?.samples || []) { return samples.reduce((n, s) => n + s.frames * 2 * (s.stereo ? 2 : 1) + 16 * (s.stereo ? 2 : 1), 0); }
function selected() { return state.bank?.samples.find(sample => sample.id === state.selectedId) || null; }

async function readEsx(source) {
  try {
    const bank = parseEsx(source.data, source.name);
    state.bank = bank; state.selectedId = bank.samples[0]?.id ?? null; state.filter = 'all'; state.query = '';
    $('#search').value = ''; $('#welcome').classList.add('hidden'); $('#workspace').classList.remove('hidden');
    $('#bank-name').textContent = source.name; $('#bank-size').textContent = formatBytes(bank.originalLength); $('#save-bank').disabled = false;
    render(); toast(`Opened ${source.name}`);
  } catch (error) { toast(error.message || 'Could not read this ESX file.', true); }
}
function openBank() {
  if (window.esxFiles) window.esxFiles.openEsx().then(file => file && readEsx(file));
  else fallbackBank.click();
}
async function audioFromBytes(bytes, name, target) {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const channels = Math.min(decoded.numberOfChannels, target.stereo ? 2 : 1);
    const offline = new OfflineAudioContext(channels, Math.max(1, Math.ceil(decoded.duration * 44100)), 44100);
    const source = offline.createBufferSource(); source.buffer = decoded;
    const splitter = offline.createChannelSplitter(Math.max(1, decoded.numberOfChannels));
    const merger = offline.createChannelMerger(channels);
    source.connect(splitter);
    for (let i = 0; i < channels; i++) splitter.connect(merger, i, i);
    if (channels === 1 && decoded.numberOfChannels > 1) {
      // Average stereo input to mono for a mono slot.
      const gain = offline.createGain(); gain.gain.value = 1 / decoded.numberOfChannels;
      source.disconnect(); source.connect(gain); gain.connect(offline.destination);
    } else merger.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const data = decodedAudioToInt16(rendered);
    replaceSampleFromAudio(target, data.channels, 44100, name);
    if (state.audio) { await state.audio.context.close(); state.audio = null; }
    await context.close();
    render(); toast(`Replaced sample ${String(target.id + 1).padStart(3, '0')}`);
  } catch (error) { toast(`Could not decode audio: ${error.message || 'unsupported format'}`, true); }
}
function openAudio() {
  const target = selected(); if (!target) return;
  if (window.esxFiles) window.esxFiles.openAudio().then(file => file && audioFromBytes(new Uint8Array(file.data), file.name, target));
  else fallbackAudio.click();
}

function visibleSamples() {
  if (!state.bank) return [];
  return state.bank.samples.filter(sample => {
    const typeMatch = state.filter === 'all' || (state.filter === 'stereo' ? sample.stereo : !sample.stereo);
    return typeMatch && sample.name.toLowerCase().includes(state.query.toLowerCase());
  });
}
function render() {
  if (!state.bank) return;
  const samples = visibleSamples(), total = state.bank.samples.length;
  $('#sample-count').textContent = total;
  $('#list-summary').textContent = `${samples.length} of ${total} samples`;
  const mem = samplesMemory(); $('#memory-label').textContent = `${(mem / 1048576).toFixed(1)} / 25 MB`;
  $('#memory-bar').style.width = `${Math.min(100, mem / (25 * 1048576) * 100)}%`;
  const list = $('#sample-list');
  if (!samples.length) list.innerHTML = '<div class="empty-list"><span>⌕</span><b>No samples match</b><small>Try another search or filter.</small></div>';
  else list.innerHTML = samples.map(sample => `<button class="sample-row ${sample.id === state.selectedId ? 'active' : ''}" data-id="${sample.id}"><span class="sample-no">${String(sample.id + 1).padStart(3, '0')}</span><span class="sample-name">${escapeHtml(sample.name)}</span><span class="sample-type"><span class="type-indicator">${sample.stereo ? '◉' : '◌'}</span>${sample.stereo ? 'STEREO' : 'MONO'}</span><span class="duration-cell">${formatTime(sample.frames / sample.rate)}</span><span class="source-cell">${sample.changed ? '<span class="changed-tag">REPLACED</span>' : 'Soundbank'}</span></button>`).join('');
  list.querySelectorAll('.sample-row').forEach(row => row.addEventListener('click', () => { state.selectedId = Number(row.dataset.id); render(); }));
  renderDetails();
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function renderDetails() {
  const sample = selected();
  $('#detail-panel').querySelector('.detail-empty').classList.toggle('hidden', !!sample);
  $('#detail-content').classList.toggle('hidden', !sample);
  if (!sample) return;
  $('#detail-id').textContent = String(sample.id + 1).padStart(3, '0');
  $('#detail-type').textContent = sample.stereo ? 'STEREO' : 'MONO';
  $('#detail-name').textContent = sample.name;
  $('#detail-origin').textContent = sample.changed ? sample.source : 'Original soundbank';
  $('#duration').textContent = formatTime(sample.frames / sample.rate);
  $('#sample-meta').textContent = `${sample.stereo ? 'Stereo' : 'Mono'} · ${sample.rate.toLocaleString()} Hz · ${formatBytes(sample.frames * 2 * (sample.stereo ? 2 : 1))}`;
  drawWave(sample);
}
function drawWave(sample) {
  const canvas = $('#waveform'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#12140f'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#293023'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  const data = sample.left, steps = w;
  ctx.strokeStyle = sample.changed ? '#d5f686' : '#a9ca69'; ctx.globalAlpha = .85; ctx.lineWidth = 1;
  for (let x = 0; x < steps; x++) {
    const start = Math.floor(x * data.length / steps), end = Math.max(start + 1, Math.floor((x + 1) * data.length / steps));
    let min = 1, max = -1;
    for (let i = start; i < end; i += Math.max(1, Math.floor((end - start) / 100))) { const value = data[i] / 32768; min = Math.min(min, value); max = Math.max(max, value); }
    ctx.beginPath(); ctx.moveTo(x + .5, (1 - max) * h / 2); ctx.lineTo(x + .5, (1 - min) * h / 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
async function playSelected() {
  const sample = selected(); if (!sample) return;
  if (state.audio?.sampleId === sample.id) { state.audio.source.stop(); await state.audio.context.close(); state.audio = null; $('#play-sample').textContent = '▶'; $('#play-label').textContent = 'Preview sample'; return; }
  if (state.audio) { try { state.audio.source.stop(); await state.audio.context.close(); } catch {} state.audio = null; }
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const previewUrl = makePreviewUrl(sample);
  const previewBytes = await (await fetch(previewUrl)).arrayBuffer();
  URL.revokeObjectURL(previewUrl);
  const decoded = await context.decodeAudioData(previewBytes);
  const source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination); source.start();
  state.audio = { context, source, sampleId: sample.id }; $('#play-sample').textContent = 'Ⅱ'; $('#play-label').textContent = 'Playing preview';
  source.onended = async () => { if (state.audio?.source === source) { state.audio = null; $('#play-sample').textContent = '▶'; $('#play-label').textContent = 'Preview sample'; await context.close(); } };
}
async function saveBank() {
  if (!state.bank) return;
  try {
    const data = buildEsx(state.bank);
    const base = state.bank.fileName.replace(/\.esx$/i, '');
    if (window.esxFiles) {
      const saved = await window.esxFiles.saveEsx({ name: `${base} - edited.esx`, data });
      if (saved) toast(`Exported ${saved.name}`);
    } else {
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })); link.download = `${base} - edited.esx`; link.click(); URL.revokeObjectURL(link.href); toast('Soundbank exported.');
    }
  } catch (error) { toast(error.message || 'Could not export soundbank.', true); }
}

$('#welcome-open').addEventListener('click', openBank);
$('#save-bank').addEventListener('click', saveBank); $('#replace-sample').addEventListener('click', openAudio); $('#play-sample').addEventListener('click', playSelected);
$('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === button)); render(); }));
fallbackBank.addEventListener('change', async event => { const file = event.target.files[0]; if (file) await readEsx({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }); fallbackBank.value = ''; });
fallbackAudio.addEventListener('change', async event => { const file = event.target.files[0]; if (file && selected()) await audioFromBytes(new Uint8Array(await file.arrayBuffer()), file.name, selected()); fallbackAudio.value = ''; });
const overlay = $('#drop-overlay');
window.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) overlay.classList.remove('hidden'); });
window.addEventListener('dragleave', event => { if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) overlay.classList.add('hidden'); });
window.addEventListener('drop', async event => { event.preventDefault(); overlay.classList.add('hidden'); const file = event.dataTransfer.files[0]; if (!file) return; if (/\.esx$/i.test(file.name)) await readEsx({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }); else if (selected()) await audioFromBytes(new Uint8Array(await file.arrayBuffer()), file.name, selected()); else toast('Open a soundbank and select a sample first.', true); });
})();
