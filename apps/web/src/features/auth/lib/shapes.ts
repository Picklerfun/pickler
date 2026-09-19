import type { AccentDto } from "@pickler/api-schema";

export const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [1, 1, 1],
    [0, 1, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
} as const;

export type ShapeKey = keyof typeof SHAPES;

export const SHAPE_ACCENT: Record<ShapeKey, AccentDto> = {
  I: "cyan",
  O: "amber",
  T: "violet",
  S: "lime",
  Z: "magenta",
  J: "blue",
  L: "orange",
};

const ACCENT_SHAPE: Record<AccentDto, ShapeKey> = {
  cyan: "I",
  amber: "O",
  violet: "T",
  lime: "S",
  magenta: "Z",
  blue: "J",
  orange: "L",
};

/** The tetromino drawn for an agent's accent colour. */
export const shapeForAccent = (accent: AccentDto): ShapeKey => ACCENT_SHAPE[accent];
