import { InvalidArgumentError } from "./errors.js";

function requireId(id: string | undefined): string {
  if (!id) {
    throw new InvalidArgumentError("id is required");
  }
  return id;
}

export function validateVolume(volume: number): void {
  if (volume < 0 || volume > 1) {
    throw new InvalidArgumentError(
      `volume must be between 0 and 1, got ${volume}`,
    );
  }
}

export function validatePan(pan: number): void {
  if (pan < -1 || pan > 1) {
    throw new InvalidArgumentError(
      `pan must be between -1 and 1, got ${pan}`,
    );
  }
}

export function validateInitialAudioPosition(position: number): void {
  if (position < 0) {
    throw new InvalidArgumentError(
      `initialAudioPosition must be >= 0, got ${position}`,
    );
  }
}

export function validateFadeSeconds(fadeSeconds: number): void {
  if (fadeSeconds < 0) {
    throw new InvalidArgumentError(
      `fadeSeconds must be >= 0, got ${fadeSeconds}`,
    );
  }
}

export function validateBgsChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
    throw new InvalidArgumentError(
      `channel must be an integer between 0 and 3, got ${channel}`,
    );
  }
}

export interface BgmPlayAttributesInput {
  id: string;
  volume?: number;
  pan?: number;
  loop?: number;
  initialAudioPosition?: number;
  fadeSeconds?: number;
}

/** BGM playback attributes. */
export class BgmPlayAttributes {
  readonly id: string;
  readonly volume: number;
  readonly pan: number;
  readonly loop: number;
  readonly initialAudioPosition: number;
  readonly fadeSeconds: number;

  constructor(input: BgmPlayAttributesInput) {
    this.id = requireId(input.id);
    this.volume = input.volume ?? 1.0;
    validateVolume(this.volume);
    this.pan = input.pan ?? 0.0;
    validatePan(this.pan);
    this.loop = input.loop ?? -1;
    this.initialAudioPosition = input.initialAudioPosition ?? 0;
    validateInitialAudioPosition(this.initialAudioPosition);
    this.fadeSeconds = input.fadeSeconds ?? 1;
    validateFadeSeconds(this.fadeSeconds);
  }
}

export interface BgsPlayAttributesInput {
  id: string;
  channel: number;
  volume?: number;
  pan?: number;
  loop?: number;
  initialAudioPosition?: number;
}

/** BGS playback attributes. */
export class BgsPlayAttributes {
  readonly id: string;
  readonly channel: number;
  readonly volume: number;
  readonly pan: number;
  readonly loop: number;
  readonly initialAudioPosition: number;

  constructor(input: BgsPlayAttributesInput) {
    this.id = requireId(input.id);
    validateBgsChannel(input.channel);
    this.channel = input.channel;
    this.volume = input.volume ?? 1.0;
    validateVolume(this.volume);
    this.pan = input.pan ?? 0.0;
    validatePan(this.pan);
    this.loop = input.loop ?? -1;
    this.initialAudioPosition = input.initialAudioPosition ?? 0;
    validateInitialAudioPosition(this.initialAudioPosition);
  }
}

export interface MePlayAttributesInput {
  id: string;
  volume?: number;
  pan?: number;
  loop?: number;
  initialAudioPosition?: number;
}

/** ME playback attributes. */
export class MePlayAttributes {
  readonly id: string;
  readonly volume: number;
  readonly pan: number;
  readonly loop: number;
  readonly initialAudioPosition: number;

  constructor(input: MePlayAttributesInput) {
    this.id = requireId(input.id);
    this.volume = input.volume ?? 1.0;
    validateVolume(this.volume);
    this.pan = input.pan ?? 0.0;
    validatePan(this.pan);
    this.loop = input.loop ?? 0;
    this.initialAudioPosition = input.initialAudioPosition ?? 0;
    validateInitialAudioPosition(this.initialAudioPosition);
  }
}

export interface SePlayAttributesInput {
  id: string;
  volume?: number;
  pan?: number;
  initialAudioPosition?: number;
}

/** SE playback attributes (no loop). */
export class SePlayAttributes {
  readonly id: string;
  readonly volume: number;
  readonly pan: number;
  readonly initialAudioPosition: number;

  constructor(input: SePlayAttributesInput) {
    this.id = requireId(input.id);
    this.volume = input.volume ?? 1.0;
    validateVolume(this.volume);
    this.pan = input.pan ?? 0.0;
    validatePan(this.pan);
    this.initialAudioPosition = input.initialAudioPosition ?? 0;
    validateInitialAudioPosition(this.initialAudioPosition);
  }
}

export interface SystemSePlayAttributesInput {
  id: string;
  volume?: number;
  pan?: number;
  initialAudioPosition?: number;
}

/** SYSTEM SE playback attributes (no loop). */
export class SystemSePlayAttributes {
  readonly id: string;
  readonly volume: number;
  readonly pan: number;
  readonly initialAudioPosition: number;

  constructor(input: SystemSePlayAttributesInput) {
    this.id = requireId(input.id);
    this.volume = input.volume ?? 1.0;
    validateVolume(this.volume);
    this.pan = input.pan ?? 0.0;
    validatePan(this.pan);
    this.initialAudioPosition = input.initialAudioPosition ?? 0;
    validateInitialAudioPosition(this.initialAudioPosition);
  }
}

export type PlayAttributesInput =
  | BgmPlayAttributesInput
  | BgsPlayAttributesInput
  | MePlayAttributesInput
  | SePlayAttributesInput
  | SystemSePlayAttributesInput;

export function toBgmPlayAttributes(
  input: BgmPlayAttributes | BgmPlayAttributesInput,
): BgmPlayAttributes {
  return input instanceof BgmPlayAttributes
    ? input
    : new BgmPlayAttributes(input);
}

export function toBgsPlayAttributes(
  input: BgsPlayAttributes | BgsPlayAttributesInput,
): BgsPlayAttributes {
  return input instanceof BgsPlayAttributes
    ? input
    : new BgsPlayAttributes(input);
}

export function toMePlayAttributes(
  input: MePlayAttributes | MePlayAttributesInput,
): MePlayAttributes {
  return input instanceof MePlayAttributes ? input : new MePlayAttributes(input);
}

export function toSePlayAttributes(
  input: SePlayAttributes | SePlayAttributesInput,
): SePlayAttributes {
  return input instanceof SePlayAttributes ? input : new SePlayAttributes(input);
}

export function toSystemSePlayAttributes(
  input: SystemSePlayAttributes | SystemSePlayAttributesInput,
): SystemSePlayAttributes {
  return input instanceof SystemSePlayAttributes
    ? input
    : new SystemSePlayAttributes(input);
}
