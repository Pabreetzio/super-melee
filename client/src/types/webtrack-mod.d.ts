declare module '@webtrack/mod' {
  export interface ModOptions {
    src?: ArrayBuffer | Int8Array;
    wasmBuffer?: ArrayBuffer;
    wasmUrl?: string;
    audioWorkletUrl?: string;
  }

  export class Mod {
    constructor(options?: ModOptions);
    loadData(data: ArrayBuffer | Int8Array): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    setVolume(volume: number): void;
  }
}

declare module '@webtrack/mod/dist/mod-processor.js?url' {
  const url: string;
  export default url;
}

declare module '@webtrack/mod/dist/hxcmod_player.wasm?url' {
  const url: string;
  export default url;
}
