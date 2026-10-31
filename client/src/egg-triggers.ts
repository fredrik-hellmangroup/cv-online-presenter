export const createClickCounter = (required: number, windowMs: number) => {
  let stamps: number[] = [];
  return (now: number): boolean => {
    stamps = stamps.filter(stamp => now - stamp <= windowMs);
    stamps.push(now);
    if (stamps.length < required) return false;
    stamps = [];
    return true;
  };
};

export const createSequenceMatcher = (sequence: readonly string[]) => {
  let buffer: string[] = [];
  return (key: string): boolean => {
    buffer.push(key.toLowerCase());
    if (buffer.length > sequence.length) buffer = buffer.slice(-sequence.length);
    if (buffer.length !== sequence.length || !sequence.every((expected, index) => buffer[index] === expected)) return false;
    buffer = [];
    return true;
  };
};
