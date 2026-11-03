// Plays the desktop app's system audio on Windows (48 kHz stereo s16 chunks from the app) into
// the share's audio track. The app and the AudioContext run on different clocks, so this keeps
// a small buffer: it waits for START before playing, skips back to START when over MAX, and
// plays silence when it runs dry.
const START = 2880; // 60 ms
const MAX = 9600; // 200 ms
const SIZE = 16384; // frames, more than MAX

class SysAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(SIZE);
    this.right = new Float32Array(SIZE);
    this.read = 0;
    this.write = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }

  get level() {
    return (this.write - this.read + SIZE) % SIZE;
  }

  push(samples) {
    for (let i = 0; i + 1 < samples.length; i += 2) {
      this.left[this.write] = samples[i] / 32768;
      this.right[this.write] = samples[i + 1] / 32768;
      this.write = (this.write + 1) % SIZE;
    }
    if (this.level > MAX) this.read = (this.write - START + SIZE) % SIZE;
  }

  process(_inputs, outputs) {
    const [l, r] = outputs[0];
    if (!this.playing && this.level >= START) this.playing = true;
    for (let i = 0; i < l.length; i++) {
      if (this.playing && this.level > 0) {
        l[i] = this.left[this.read];
        if (r) r[i] = this.right[this.read];
        this.read = (this.read + 1) % SIZE;
      } else {
        this.playing = false;
        l[i] = 0;
        if (r) r[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor("sysaudio", SysAudio);
