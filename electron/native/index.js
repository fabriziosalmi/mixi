/**
 * Mixi Native Audio — N-API Binding Loader
 *
 * Loads the platform-specific .node addon compiled from mixi-native (Rust/cpal).
 * Exposes:
 *   - enumerateOutputDevices()  → AudioDeviceInfo[]
 *   - openStream(...)           → void
 *   - closeStream()             → void
 *   - getHostName()             → string
 *   - isNativeAudioAvailable()  → boolean
 */

const os = require('os');
const path = require('path');

function loadNativeAddon() {
  const platform = os.platform();  // 'darwin', 'win32', 'linux'
  const arch = os.arch();          // 'arm64', 'x64'

  // Map to addon filename
  const platformMap = {
    darwin: 'darwin',
    win32: 'win32',
    linux: 'linux',
  };

  const addonName = `mixi_native.${platformMap[platform] || platform}-${arch}.node`;
  const addonPath = path.join(__dirname, addonName);

  try {
    return require(addonPath);
  } catch (err) {
    console.warn(`[mixi-native] Failed to load ${addonName}: ${err.message}`);
    return null;
  }
}

const addon = loadNativeAddon();

module.exports = {
  /** Check if native audio addon is loaded */
  isLoaded: () => addon !== null,

  /** Enumerate audio output devices via cpal */
  enumerateOutputDevices: () => {
    if (!addon) return [];
    return addon.enumerateOutputDevices();
  },

  /** Open a native cpal audio output stream */
  openStream: (deviceIndex, sampleRate, bufferSize, ringBuffer, ringCapacityFrames, ringChannels) => {
    if (!addon) throw new Error('Native audio addon not available');
    return addon.openStream(deviceIndex, sampleRate, bufferSize, ringBuffer, ringCapacityFrames, ringChannels);
  },

  /** Close the active native audio stream */
  closeStream: () => {
    if (!addon) return;
    return addon.closeStream();
  },

  /** Get the audio host backend name (CoreAudio, WASAPI, ALSA) */
  getHostName: () => {
    if (!addon) return 'WebAudio';
    return addon.getHostName();
  },

  /** Check if cpal can enumerate at least 1 output device */
  isNativeAudioAvailable: () => {
    if (!addon) return false;
    return addon.isNativeAudioAvailable();
  },
};
