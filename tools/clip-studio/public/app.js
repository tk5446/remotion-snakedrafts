/* global document, fetch */

const $ = (sel) => document.querySelector(sel);
const downloadedVideos = new Map(); // id -> { id, title }

// ─── Status ────────────────────────────────────────────────────────────────────

function status(msg, isError) {
  const el = $("#status-bar");
  el.textContent = msg;
  el.className = isError ? "error" : "ok";
}

// ─── Search ────────────────────────────────────────────────────────────────────

$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  if (!q) return;

  status("Searching...");
  $("#search-status").textContent = "Searching (fetching results + durations)...";
  $("#results-list").innerHTML = "";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");

    $("#search-status").textContent = `${data.results.length} results`;
    renderResults(data.results);
    status(`Found ${data.results.length} results`);
  } catch (err) {
    status(err.message, true);
    $("#search-status").textContent = "";
  }
});

function renderResults(results) {
  const list = $("#results-list");
  list.innerHTML = "";

  for (const r of results) {
    const card = document.createElement("div");
    card.className = "result-card";

    const thumb = document.createElement("img");
    thumb.src = r.thumbnail;
    thumb.alt = r.title;
    thumb.loading = "lazy";

    const info = document.createElement("div");
    info.className = "result-info";

    const title = document.createElement("a");
    title.className = "result-title";
    title.href = r.url;
    title.target = "_blank";
    title.rel = "noopener";
    title.textContent = r.title;

    const meta = document.createElement("span");
    meta.className = "result-meta";
    meta.textContent = r.durationString ? `Duration: ${r.durationString}` : "Duration: unknown";

    const btn = document.createElement("button");
    btn.className = "dl-btn";
    btn.textContent = downloadedVideos.has(r.id) ? "Downloaded" : "Download";
    btn.disabled = downloadedVideos.has(r.id);
    btn.addEventListener("click", () => handleDownload(r, btn));

    info.append(title, meta, btn);
    card.append(thumb, info);
    list.append(card);
  }
}

// ─── Download ──────────────────────────────────────────────────────────────────

async function handleDownload(video, btn) {
  btn.disabled = true;
  btn.textContent = "Downloading...";
  status(`Downloading ${video.id}...`);

  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: video.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Download failed");

    btn.textContent = "Downloaded";
    downloadedVideos.set(video.id, { id: video.id, title: video.title });
    updateClipDropdown();
    status(`Downloaded to ${data.rawPath}`);
  } catch (err) {
    btn.textContent = "Retry";
    btn.disabled = false;
    status(err.message, true);
  }
}

// ─── Clip Builder ──────────────────────────────────────────────────────────────

function updateClipDropdown() {
  const sel = $("#clip-video");
  sel.innerHTML = "";

  if (downloadedVideos.size === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— download a video first —";
    sel.append(opt);
    return;
  }

  for (const [id, v] of downloadedVideos) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${v.title} (${id})`;
    sel.append(opt);
  }
}

$("#generate-btn").addEventListener("click", async () => {
  const id = $("#clip-video").value;
  if (!id) return status("Select a downloaded video first", true);

  const start = $("#clip-start").value.trim() || "0";
  const endVal = $("#clip-end").value.trim() || undefined;
  const durVal = $("#clip-duration").value.trim() || undefined;
  const wRaw = $("#clip-w").value.trim();
  const hRaw = $("#clip-h").value.trim();
  const name = $("#clip-name").value.trim() || undefined;

  const body = { id, start };
  if (endVal) body.end = endVal;
  if (durVal) body.duration = Number(durVal);
  if (wRaw && hRaw) {
    body.targetW = parseInt(wRaw, 10);
    body.targetH = parseInt(hRaw, 10);
    body.mode = "centerCrop";
  }
  if (name) body.name = name;

  status("Generating clip...");
  $("#generate-btn").disabled = true;

  try {
    const res = await fetch("/api/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Clip failed");

    status(`Clip created: ${data.outPath}`);
    showOutput(data.outPath);
  } catch (err) {
    status(err.message, true);
  } finally {
    $("#generate-btn").disabled = false;
  }
});

function showOutput(outPath) {
  const section = $("#output-section");
  section.classList.remove("hidden");

  $("#output-path").textContent = outPath;

  const video = $("#output-preview");
  // Serve from /media/out/<file> — outPath is "media/out/<file>.mp4"
  video.src = `/assets/${outPath}?t=${Date.now()}`;
  video.load();
}
