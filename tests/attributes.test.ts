import { describe, expect, it } from "vitest";

import {
  BgmPlayAttributes,
  BgsPlayAttributes,
  InvalidArgumentError,
  MePlayAttributes,
  SePlayAttributes,
  SystemSePlayAttributes,
} from "../src/index.js";

describe("play attribute validation", () => {
  it("rejects out-of-range volume", () => {
    expect(() => new BgmPlayAttributes({ id: "a", volume: 1.1 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new SePlayAttributes({ id: "a", volume: -0.1 })).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects out-of-range pan", () => {
    expect(() => new MePlayAttributes({ id: "a", pan: -1.1 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new SystemSePlayAttributes({ id: "a", pan: 2 })).toThrow(
      InvalidArgumentError,
    );
  });

  it("requires BGS channel in 0..3", () => {
    expect(() => new BgsPlayAttributes({ id: "a", channel: 4 })).toThrow(
      InvalidArgumentError,
    );
    expect(() => new BgsPlayAttributes({ id: "a", channel: -1 })).toThrow(
      InvalidArgumentError,
    );
  });

  it("applies category defaults", () => {
    const bgm = new BgmPlayAttributes({ id: "bgm" });
    const bgs = new BgsPlayAttributes({ id: "bgs", channel: 2 });
    const me = new MePlayAttributes({ id: "me" });
    const se = new SePlayAttributes({ id: "se" });

    expect(bgm.loop).toBe(-1);
    expect(bgm.fadeSeconds).toBe(1);
    expect(bgs.loop).toBe(-1);
    expect(me.loop).toBe(0);
    expect(se.initialAudioPosition).toBe(0);
  });
});
