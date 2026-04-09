import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { QuoteCuration } from "./pages/QuoteCuration";
import { ClipReview } from "./pages/ClipReview";
import { RenderPrep } from "./pages/RenderPrep";
import { TerminalPanel, type LogLine } from "./components/TerminalPanel";

type Page = "dashboard" | "quotes" | "review" | "render";

async function runScript(
  script: string,
  args: string[],
  onLine: (line: LogLine) => void
): Promise<void> {
  const res = await fetch("/api/run/" + script, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (line) {
        try { onLine(JSON.parse(line)); } catch {}
      }
    }
  }
}

export default function App() {
  const [page, setPage]       = useState<Page>("dashboard");
  const [actorSlug, setActorSlug] = useState<string>("");
  const [findLogs, setFindLogs]   = useState<LogLine[]>([]);
  const [findRunning, setFindRunning] = useState(false);

  function navigate(p: string, slug?: string) {
    setPage(p as Page);
    if (slug) setActorSlug(slug);
  }

  async function handleFindClips(slug: string) {
    setFindLogs([]);
    setFindRunning(true);
    setActorSlug(slug);
    await runScript("find_clips", [slug], (line) => setFindLogs((prev) => [...prev, line]));
    setFindRunning(false);
    // Navigate to review once done
    setPage("review");
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {page === "dashboard" && (
        <Dashboard onNavigate={navigate} />
      )}

      {page === "quotes" && actorSlug && (
        <>
          <QuoteCuration
            actorSlug={actorSlug}
            onBack={() => setPage("dashboard")}
            onFindClips={handleFindClips}
          />
          {/* Terminal overlay for find_clips running after quote curation */}
          {findRunning && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-100 border-t border-gray-200 z-50">
              <TerminalPanel lines={findLogs} running={findRunning} />
            </div>
          )}
        </>
      )}

      {page === "review" && actorSlug && (
        <ClipReview
          actorSlug={actorSlug}
          onBack={() => setPage("dashboard")}
        />
      )}

      {page === "render" && actorSlug && (
        <RenderPrep
          actorSlug={actorSlug}
          onBack={() => setPage("dashboard")}
        />
      )}
    </div>
  );
}
