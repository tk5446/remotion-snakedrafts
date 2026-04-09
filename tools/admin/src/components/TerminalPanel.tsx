import { useEffect, useRef } from "react";

export interface LogLine {
  type: "stdout" | "stderr" | "done" | "error";
  text?: string;
  code?: number | null;
  signal?: string | null;
  message?: string;
}

interface Props {
  lines: LogLine[];
  running: boolean;
}

export function TerminalPanel({ lines, running }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  if (lines.length === 0 && !running) return null;

  return (
    <div className="mt-4 rounded-lg bg-black border border-[#333] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a1a] border-b border-[#333]">
        <span className="text-xs text-gray-400 font-mono">Terminal</span>
        {running && (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            running…
          </span>
        )}
        {!running && lines.length > 0 && (
          <span className="text-xs text-green-400">done</span>
        )}
      </div>
      <div className="p-3 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
        {lines.map((line, i) => {
          if (line.type === "stderr" || line.type === "error") {
            return (
              <div key={i} className="text-red-400 whitespace-pre-wrap">
                {line.text || line.message}
              </div>
            );
          }
          if (line.type === "done") {
            const ok = line.code === 0;
            const label = ok
              ? "✓ Completed successfully"
              : line.code == null
              ? `✗ Killed by signal (${line.signal ?? "unknown"}) — script may have been interrupted`
              : `✗ Exited with code ${line.code}`;
            return (
              <div key={i} className={ok ? "text-green-400" : "text-red-400"}>
                {label}
              </div>
            );
          }
          return (
            <div key={i} className="text-gray-300 whitespace-pre-wrap">
              {line.text}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
