export type TextSelection = {
  start: number;
  end: number;
};

const DISALLOWED_INPUT = /[^0-9+\-'\u00B0\s]/g;

export function sanitizeTransposerInput(value: string): string {
  return value.replaceAll('’', "'").replace(DISALLOWED_INPUT, '');
}

export function insertAtSelection(value: string, selection: TextSelection, text: string): {
  nextValue: string;
  nextSelection: TextSelection;
} {
  const source = value ?? '';
  const maxIndex = source.length;
  const start = Math.max(0, Math.min(selection.start, maxIndex));
  const end = Math.max(start, Math.min(selection.end, maxIndex));
  const insertion = sanitizeTransposerInput(text);
  const nextValue = `${source.slice(0, start)}${insertion}${source.slice(end)}`;
  const cursor = start + insertion.length;
  return {
    nextValue,
    nextSelection: { start: cursor, end: cursor },
  };
}
