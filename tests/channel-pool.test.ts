import { describe, expect, it } from "vitest";

import { ChannelPool } from "../src/channel-pool.js";
import { InvalidArgumentError } from "../src/index.js";

describe("ChannelPool", () => {
  it("allocates free channels in order", () => {
    const pool = new ChannelPool(4);

    expect(pool.allocate()).toEqual({ channel: 0, reused: false });
    expect(pool.allocate()).toEqual({ channel: 1, reused: false });
    expect(pool.isInUse(0)).toBe(true);
    expect(pool.isInUse(2)).toBe(false);
  });

  it("releases channels for reuse", () => {
    const pool = new ChannelPool(2);

    const first = pool.allocate();
    pool.release(first.channel);

    expect(pool.isInUse(first.channel)).toBe(false);
    expect(pool.allocate()).toEqual({ channel: first.channel, reused: false });
  });

  it("reclaims the oldest channel when full", () => {
    const pool = new ChannelPool(2);

    pool.allocate(); // 0
    pool.allocate(); // 1
    const third = pool.allocate(); // steal 0

    expect(third).toEqual({ channel: 0, reused: true });
    expect(pool.isInUse(0)).toBe(true);
    expect(pool.isInUse(1)).toBe(true);
  });

  it("acquires a specific channel and marks reuse", () => {
    const pool = new ChannelPool(4);

    expect(pool.acquire(2)).toEqual({ channel: 2, reused: false });
    expect(pool.acquire(2)).toEqual({ channel: 2, reused: true });
  });

  it("rejects invalid channel indices", () => {
    const pool = new ChannelPool(4);

    expect(() => pool.acquire(4)).toThrow(InvalidArgumentError);
    expect(() => pool.release(-1)).toThrow(InvalidArgumentError);
  });
});
