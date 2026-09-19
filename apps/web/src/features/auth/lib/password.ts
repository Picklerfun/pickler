export const PASSWORD_MIN = 8;

/** 0 empty/too short, 1 weak, 2 ok, 3 strong — the design's meter. */
export function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (password.length < PASSWORD_MIN) {
    return 0;
  }
  let score = 1;
  if (password.length >= 12) {
    score++;
  }
  if (/[^a-zA-Z]/.test(password) && /[a-zA-Z]/.test(password)) {
    score++;
  }
  return Math.min(3, score) as 1 | 2 | 3;
}

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
