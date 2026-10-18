import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 6;

type Props = { onComplete: (code: string) => void };

/** Six single-digit boxes. Calls onComplete once every box holds a digit. */
export default function CodeInput({ onComplete }: Props) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: LENGTH }, () => ""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  /** Write digits starting at `start`, then move focus or complete the code. */
  const fillFrom = (start: number, chars: string) => {
    const next = [...digits];
    let last = start;
    for (let k = 0; k < chars.length && start + k < LENGTH; k++) {
      next[start + k] = chars[k];
      last = start + k;
    }
    setDigits(next);
    if (next.every((d) => d !== "")) {
      onComplete(next.join(""));
      return;
    }
    focusBox(Math.min(last + 1, LENGTH - 1));
  };

  const onChange = (i: number, e: ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.value.replace(/\D/g, "");
    // A filled box receiving a second digit: keep only the new one.
    const added = incoming.length > 1 && digits[i] ? incoming.replace(digits[i], "") : incoming;
    if (added === "") {
      const next = [...digits];
      next[i] = "";
      setDigits(next);
      return;
    }
    fillFrom(i, added);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    fillFrom(text.length >= LENGTH ? 0 : i, text.slice(0, LENGTH));
  };

  return (
    <div className="code-input" role="group" aria-label="6-digit room code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="code-box"
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          value={d}
          onChange={(e) => onChange(i, e)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
