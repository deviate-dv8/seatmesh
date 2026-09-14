const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const metaEl = document.getElementById("meta");
const formErr = document.getElementById("form-err");
const kindEl = document.getElementById("kind");
const underWrap = document.getElementById("under-wrap");

kindEl.addEventListener("change", () => {
  underWrap.classList.toggle("hidden", kindEl.value !== "slice");
});

function api(path, opts) {
  return fetch(path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts?.headers || {}),
    },
  }).then(async (r) => {
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(text.slice(0, 160) || r.statusText);
    }
    if (!r.ok) throw new Error(json?.error || r.statusText);
    return json;
  });
}

async function parseDeadline(raw) {
  const t = (raw || "eod").trim();
  if (!t || /^eod$/i.test(t)) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  if (/^\d+[smhdw]$/i.test(t)) {
    const n = Number(t.slice(0, -1));
    const u = t.slice(-1).toLowerCase();
    const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[u];
    return new Date(Date.now() + n * mult).toISOString();
  }
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Error("bad deadline (eod | 6h | ISO)");
  return new Date(ms).toISOString();
}

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function sortTargets(rows) {
  const scopes = rows.filter((r) => r.kind !== "slice" && !r.parentId);
  const slices = rows.filter((r) => r.kind === "slice" || r.parentId);
  const out = [];
  for (const s of scopes.sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt))) {
    out.push(s);
    out.push(
      ...slices
        .filter((c) => c.parentId && (s.id === c.parentId || s.id.startsWith(c.parentId) || c.parentId.startsWith(s.id)))
        .sort((a, b) => a.deadlineAt.localeCompare(b.deadlineAt)),
    );
  }
  for (const c of slices) {
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

function render(rows) {
  listEl.innerHTML = "";
  const ordered = sortTargets(rows);
  emptyEl.hidden = ordered.length > 0;
  for (const t of ordered) {
    const card = document.createElement("article");
    const kind = t.kind || (t.parentId ? "slice" : "scope");
    card.className = `card ${kind} ${t.status}`;
    const parent = t.parentId ? ` · under ${t.parentId.slice(0, 8)}` : "";
    card.innerHTML = `
      <div>
        <div class="goal">${escapeHtml(t.goal)}</div>
        <div class="tags">${escapeHtml(t.id.slice(0, 12))} · ${kind}${parent} · ${t.status} · due ${fmtWhen(t.deadlineAt)}</div>
      </div>
      <div class="actions"></div>
    `;
    const actions = card.querySelector(".actions");
    if (t.status === "active") {
      actions.append(
        btn("Triage", () => act(t.id, "triage")),
        btn("Remind", () => act(t.id, "remind")),
        btn("Done", () => act(t.id, "done"), "ok"),
        btn("Cancel", () => act(t.id, "cancel"), "danger"),
      );
      if (kind === "scope") {
        actions.append(
          btn("+ slice", () => {
            kindEl.value = "slice";
            underWrap.classList.remove("hidden");
            document.getElementById("under").value = t.id;
            document.getElementById("goal").focus();
          }, "ghost"),
        );
      }
    }
    listEl.appendChild(card);
  }
}

function btn(label, onClick, tone) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `tiny${tone === "ghost" ? " ghost" : ""}`;
  if (tone === "ok") b.style.background = "var(--ok)";
  if (tone === "danger") b.style.background = "var(--danger)";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function act(id, action) {
  try {
    await api(`/targets/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    await refresh();
  } catch (e) {
    alert(e.message || String(e));
  }
}

async function refresh() {
  const all = document.getElementById("show-all").checked;
  const data = await api(`/targets${all ? "?all=1" : ""}`);
  render(data.targets || []);
  metaEl.textContent = `${(data.targets || []).length} shown · ${location.host}`;
}

document.getElementById("add-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  formErr.hidden = true;
  try {
    const goal = document.getElementById("goal").value.trim();
    const deadlineAt = await parseDeadline(document.getElementById("deadline").value);
    const kind = kindEl.value;
    const parentId = kind === "slice" ? document.getElementById("under").value.trim() : undefined;
    if (kind === "slice" && !parentId) throw new Error("slice needs under scope id");
    await api("/targets", {
      method: "POST",
      body: JSON.stringify({ goal, deadlineAt, kind, parentId }),
    });
    document.getElementById("goal").value = "";
    await refresh();
  } catch (e) {
    formErr.hidden = false;
    formErr.textContent = e.message || String(e);
  }
});

document.getElementById("refresh").addEventListener("click", () => refresh().catch(console.error));
document.getElementById("show-all").addEventListener("change", () => refresh().catch(console.error));

refresh().catch((e) => {
  metaEl.textContent = "API error";
  formErr.hidden = false;
  formErr.textContent = e.message || String(e);
});
