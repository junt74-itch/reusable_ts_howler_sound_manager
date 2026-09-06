import { InvalidArgumentError } from "./errors.js";

export interface ChannelAllocationResult {
  channel: number;
  /** True when an in-use channel was reclaimed (oldest). */
  reused: boolean;
}

/**
 * Manages simultaneous playback slots for one sound category.
 */
export class ChannelPool {
  private readonly capacity: number;
  private readonly inUse: boolean[];
  private readonly lastAssignedAt: number[];
  private assignmentCounter = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new InvalidArgumentError(
        "ChannelPool capacity must be an integer greater than or equal to 1",
      );
    }
    this.capacity = capacity;
    this.inUse = Array.from({ length: capacity }, () => false);
    this.lastAssignedAt = Array.from({ length: capacity }, () => 0);
  }

  get channelCount(): number {
    return this.capacity;
  }

  isInUse(channel: number): boolean {
    this.assertValidChannel(channel);
    return this.inUse[channel] ?? false;
  }

  /** Returns the first free channel index, or undefined when the pool is full. */
  findFreeChannel(): number | undefined {
    const freeChannel = this.inUse.findIndex((used) => !used);
    return freeChannel === -1 ? undefined : freeChannel;
  }

  /** Assigns the first free channel, or reclaims the oldest in-use channel. */
  allocate(): ChannelAllocationResult {
    const freeChannel = this.inUse.findIndex((used) => !used);
    if (freeChannel !== -1) {
      this.inUse[freeChannel] = true;
      this.lastAssignedAt[freeChannel] = ++this.assignmentCounter;
      return { channel: freeChannel, reused: false };
    }

    let oldestChannel = 0;
    for (let i = 1; i < this.capacity; i += 1) {
      if (this.lastAssignedAt[i]! < this.lastAssignedAt[oldestChannel]!) {
        oldestChannel = i;
      }
    }

    this.inUse[oldestChannel] = true;
    this.lastAssignedAt[oldestChannel] = ++this.assignmentCounter;
    return { channel: oldestChannel, reused: true };
  }

  /** Acquires a specific channel, replacing any existing occupant. */
  acquire(channel: number): ChannelAllocationResult {
    this.assertValidChannel(channel);
    const reused = this.inUse[channel] ?? false;
    this.inUse[channel] = true;
    this.lastAssignedAt[channel] = ++this.assignmentCounter;
    return { channel, reused };
  }

  release(channel: number): void {
    this.assertValidChannel(channel);
    this.inUse[channel] = false;
  }

  private assertValidChannel(channel: number): void {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.capacity) {
      throw new InvalidArgumentError(
        `channel must be an integer between 0 and ${this.capacity - 1}, got ${channel}`,
      );
    }
  }
}
