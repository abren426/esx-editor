# ESX Soundbank Studio

A small desktop editor for Korg Electribe ESX-1 `.esx` soundbanks. It opens a bank, lists and previews embedded samples, replaces a sample slot from an audio file, and exports an edited bank to a new `.esx` file.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Build a distributable for the current operating system with `npm run dist`.

## Use

1. Choose **Open ESX** and select a soundbank, or drop an `.esx` file into the app.
2. Select any listed sample to preview it.
3. Choose **Choose audio file** (or drop audio onto the app) to replace that slot.
4. Choose **Export soundbank** and save the new ESX file.

The app accepts audio formats supported by Chromium's built-in audio decoder. Replacement audio is resampled to 44.1 kHz, 16-bit PCM. The app preserves the original soundbank's pattern, song, and global data sections; export rebuilds the sample blocks and sample offsets. The ESX sample-data capacity is limited to 25,165,824 bytes.

All processing happens locally on the computer.
