/*
 * Bilder-Rätsel – touristisches Bild-Duell
 *
 * Der umschließende HTML-Code ist:
 *      <body>
 *      <div class="container mt-4" id="main-content">
 *          ...
 *      </div>
 *      </body>
 * Als CSS-Framework wird Bootstrap 5.3 verwendet.
 *
 * Die App macht aus einem POI-Datensatz (schema.org/ODTA, z. B. TouristAttraction)
 * ein Ratespiel: Ein Foto einer Sehenswürdigkeit wird gezeigt, der/die Spieler:in
 * wählt zwischen zwei Namen ("Ist das X oder Y?").
 *
 * Datenquelle:
 *   - Die App lädt ausschließlich die verpflichtend konfigurierte HTTP(S)-`apiurl`
 *     eines Open-Data-Portals – direkt oder über den ODAS-Proxy, gesteuert durch
 *     `proxyAktiv`. Es gibt keinen eingebetteten Datenbestand und keinen Fallback;
 *     eine leere, ungelöste oder ungültige `apiurl` ist ein sichtbarer
 *     Konfigurationsfehler und löst keinen Fetch aus.
 *
 * ConfigData (Beispiel):
 *     {
 *         "apiurl": "<HTTP(S)-URL der Portalressource>",
 *         "proxyAktiv": "ja"
 *     }
 *
 * Jeder app()-Aufruf erzeugt einen vollständig instanzbezogenen Closure-State,
 * der in der iterierbaren Map GAME_RUNTIMES registriert wird. Der globale
 * Base-Hook onPageLeave(page) disposed alle aktiven Instanzen, bevor die
 * nächste Seite gerendert wird.
 *
 * @param {Object} configdata - Alle Konfigurationsdaten der App
 * @param {HTMLElement} enclosingHtmlDivElement - HTML-Knoten des umschließenden Tags
 * @returns {void} - Der Inhaltsbereich wird direkt manipuliert.
 */

const HIGHSCORE_KEY = "oda-bilder-raetsel-highscore";
const THEME_KEY = "oda-bilder-raetsel-theme";
const THEME_MODES = ["auto", "light", "dark"];
const THEME_LABELS = { auto: "Auto", light: "Hell", dark: "Dunkel" };

// Schwierigkeitsgrade steuern automatisch Leben, Rundentimer und Distraktor-Härte.
// lives = Gesamtzahl der Leben (hardcore/schwer = 1 Leben = keine Extra-Leben).
// timer = Sekunden pro Runde (0 = kein Zeitlimit).
// sameCategory = Distraktor bevorzugt aus derselben Kategorie (ähnlichere Namen).
const DIFFICULTIES = [
  { id: "leicht", label: "Leicht", lives: 3, timer: 0, sameCategory: false, hint: "3 Leben · kein Zeitlimit" },
  { id: "mittel", label: "Mittel", lives: 2, timer: 20, sameCategory: false, hint: "2 Leben · 20 s pro Runde" },
  { id: "schwer", label: "Schwer", lives: 1, timer: 12, sameCategory: true, hint: "1 Leben · 12 s · ähnliche Namen" },
  { id: "hardcore", label: "Hardcore", lives: 1, timer: 7, sameCategory: true, hint: "1 Leben · 7 s · gnadenlos" },
];

// Aktive Spiel-Runtimes je Container. Kein geteilter Spiel- oder Datenzustand:
// jede Instanz hält ihren eigenen Closure-State in createRuntime().
const GAME_RUNTIMES = new Map();
let gameInstanceCounter = 0;

async function app(configdata = {}, enclosingHtmlDivElement) {
  if (!enclosingHtmlDivElement) {
    throw new Error("Der Inhaltsbereich der App wurde nicht gefunden.");
  }

  const previous = GAME_RUNTIMES.get(enclosingHtmlDivElement);
  if (previous) {
    previous.dispose();
  }

  const runtime = createRuntime(enclosingHtmlDivElement, configdata);
  GAME_RUNTIMES.set(enclosingHtmlDivElement, runtime);
  await runtime.start();
}

// Vom Base-Runtime vor jedem Seitenwechsel aufgerufener Hook.
function onPageLeave(page) {
  GAME_RUNTIMES.forEach((runtime) => runtime.dispose());
}

/* --------------------------------------------------------------------------
 * Instanzbezogene Runtime
 * ----------------------------------------------------------------------- */

function createRuntime(container, configdata) {
  const state = {
    instanceId: (gameInstanceCounter += 1),
    container,
    config: configdata || {},
    source: resolveSource(configdata || {}),
    pools: { imagePois: [], pois: [], names: [] },
    difficulty: null,
    score: 0,
    lives: 0,
    timeLeft: 0,
    prevBest: 0,
    timerId: null,
    timeoutHandles: new Set(),
    roundToken: 0,
    lifecycleToken: 0,
    disposed: false,
    lastId: null,
    current: null,
    imageFails: 0,
    highscore: readHighscores(),
    answerStatus: "",
    screen: "loading",
    discarded: 0,
    format: "",
  };

  /* ---- Timer-/Timeout-Verwaltung ---- */

  function clearRoundTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function cancelScheduled() {
    clearRoundTimer();
    state.timeoutHandles.forEach((handle) => window.clearTimeout(handle));
    state.timeoutHandles.clear();
  }

  // Jeder verzögerte Übergang läuft durch diesen Helfer: Das Handle wird im
  // State geführt, und die Ausführung prüft Lifecycle-Token und disposed-Flag.
  function schedule(fn, delayMs) {
    const token = state.lifecycleToken;
    const handle = window.setTimeout(() => {
      state.timeoutHandles.delete(handle);
      if (state.disposed || token !== state.lifecycleToken) {
        return;
      }
      fn();
    }, delayMs);
    state.timeoutHandles.add(handle);
    return handle;
  }

  /* ---- Lifecycle ---- */

  function dispose() {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    state.lifecycleToken += 1;
    state.roundToken += 1;
    cancelScheduled();
    container.removeEventListener("keydown", onKeydown);
    container.classList.remove("oda-game-host");
    container.removeAttribute("data-oda-theme");
    GAME_RUNTIMES.delete(container);
    state.screen = "disposed";
  }

  function goToStart() {
    cancelScheduled();
    state.roundToken += 1;
    state.current = null;
    state.lastId = null;
    state.imageFails = 0;
    state.answerStatus = "";
    renderStart(true);
  }

  async function start() {
    container.classList.add("oda-game-host");
    applyTheme(readTheme());
    container.addEventListener("keydown", onKeydown);
    container.innerHTML = renderLoading();

    if (state.source.kind === "config-error") {
      state.screen = "config-error";
      container.innerHTML = renderConfigError();
      console.error(
        `[Bilder-Rätsel] Keine gültige Datenquelle konfiguriert (${state.source.reason}); apiurl = ${JSON.stringify(state.config.apiurl || "")}`,
      );
      return;
    }

    try {
      const text = await fetchOdasResource(state.source.url, state.config);
      if (state.disposed) {
        return;
      }
      const parsed = await parseSource(text);
      if (state.disposed) {
        return;
      }
      state.format = parsed.format;
      state.discarded = parsed.discarded;
      if (parsed.discarded > 0) {
        console.warn(
          `[Bilder-Rätsel] ${parsed.discarded} Datensätze wurden wegen fehlerhafter Struktur übersprungen.`,
          parsed.warnings.slice(0, 5),
        );
      }

      if (parsed.records.length === 0) {
        state.screen = "empty";
        container.innerHTML =
          parsed.discarded > 0
            ? renderEmpty(true)
            : renderEmpty(false);
        return;
      }

      state.pools = buildPools(parsed.records);
      if (state.disposed) {
        return;
      }

      if (state.pools.imagePois.length === 0 || state.pools.names.length < 2) {
        state.screen = "quality-error";
        container.innerHTML = renderQualityError();
        return;
      }

      renderStart(false);
    } catch (error) {
      if (state.disposed) {
        return;
      }
      state.screen = "fetch-error";
      container.innerHTML = renderSourceError();
      console.error("[Bilder-Rätsel] Datenabruf fehlgeschlagen:", error);
    }
  }

  /* ---- Tastatursteuerung (containerlokal) ---- */

  function onKeydown(event) {
    if (event.key !== "1" && event.key !== "2") {
      return;
    }
    if (!state.current || state.current.answered) {
      return;
    }
    const buttons = container.querySelectorAll(".oda-answer-btn");
    const target = buttons[event.key === "1" ? 0 : 1];
    if (target) {
      target.click();
    }
  }

  /* ---- Spielablauf ---- */

  function startGame(difficulty) {
    cancelScheduled();
    state.roundToken += 1;
    state.difficulty = difficulty || DIFFICULTIES[0];
    state.score = 0;
    state.lives = state.difficulty.lives;
    state.prevBest = getBest(state.difficulty.id);
    state.lastId = null;
    state.imageFails = 0;
    state.current = null;
    state.answerStatus = "";
    nextRound();
  }

  function nextRound() {
    if (state.disposed) {
      return;
    }
    const pool = state.pools.imagePois;
    // Keine unmittelbare Wiederholung: bei mehr als einem Bild alle Einträge
    // mit der id der vorherigen Runde vor der Zufallsauswahl herausfiltern.
    const candidates = pool.length > 1 ? pool.filter((p) => p.id !== state.lastId) : pool;
    const solution = candidates[Math.floor(Math.random() * candidates.length)];
    state.lastId = solution.id;

    const distractor = pickDistractor(solution);
    if (!distractor) {
      state.screen = "quality-error";
      container.innerHTML = renderQualityError();
      return;
    }

    const options =
      Math.random() < 0.5 ? [solution.name, distractor] : [distractor, solution.name];

    state.roundToken += 1;
    state.current = { solution, options, answered: false };
    state.answerStatus = "";
    renderRound();
    startRoundTimer();
  }

  // Wählt einen falschen Namen. Bei schweren Graden bevorzugt aus derselben
  // Kategorie (ähnlichere, schwerere Auswahl); sonst zufällig. Garantiert
  // verschieden vom Lösungsnamen – ohne Guard-Schleife und ohne Fallback.
  function pickDistractor(solution) {
    if (state.difficulty && state.difficulty.sameCategory && solution.category) {
      const sameCat = state.pools.pois.filter(
        (p) => p.category === solution.category && p.name !== solution.name,
      );
      if (sameCat.length) {
        return sameCat[Math.floor(Math.random() * sameCat.length)].name;
      }
    }
    const names = state.pools.names.filter((n) => n !== solution.name);
    return names.length ? names[Math.floor(Math.random() * names.length)] : "";
  }

  function handleAnswer(chosenName, buttonElement) {
    if (!state.current || state.current.answered) {
      return;
    }
    cancelScheduled();
    state.current.answered = true;
    revealSolution();

    if (chosenName === state.current.solution.name) {
      state.score += 1;
      state.answerStatus = "Richtig.";
      updateHud();
      announceAnswer();
      schedule(() => nextRound(), 750);
    } else {
      state.answerStatus = `Falsch. Richtig wäre ${state.current.solution.name}.`;
      if (buttonElement) {
        buttonElement.classList.add("is-wrong");
      }
      announceAnswer();
      loseLife();
    }
  }

  // Zeit abgelaufen: zählt wie eine falsche Antwort.
  function onRoundTimeout() {
    if (!state.current || state.current.answered) {
      return;
    }
    state.current.answered = true;
    revealSolution();
    loseLife();
  }

  function revealSolution() {
    const solutionName = state.current.solution.name;
    container.querySelectorAll(".oda-answer-btn").forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.name === solutionName) {
        btn.classList.add("is-correct");
      }
    });
  }

  function loseLife() {
    state.lives -= 1;
    updateHud();
    schedule(state.lives <= 0 ? renderGameOver : nextRound, 1200);
  }

  function startRoundTimer() {
    clearRoundTimer();
    const seconds = state.difficulty ? state.difficulty.timer : 0;
    if (!seconds) {
      return;
    }
    state.timeLeft = seconds;
    updateTimerUi();
    const token = state.lifecycleToken;
    state.timerId = window.setInterval(() => {
      if (state.disposed || token !== state.lifecycleToken) {
        window.clearInterval(state.timerId);
        state.timerId = null;
        return;
      }
      state.timeLeft -= 1;
      updateTimerUi();
      if (state.timeLeft <= 0) {
        window.clearInterval(state.timerId);
        state.timerId = null;
        onRoundTimeout();
      }
    }, 1000);
  }

  function updateTimerUi() {
    const total = state.difficulty ? state.difficulty.timer : 0;
    const valueEl = container.querySelector('[data-role="timer-value"]');
    const barEl = container.querySelector('[data-role="timer-bar"]');
    if (valueEl) {
      valueEl.textContent = state.timeLeft;
    }
    if (barEl && total) {
      barEl.style.width = `${Math.max(0, (state.timeLeft / total) * 100)}%`;
      barEl.classList.toggle("is-low", state.timeLeft <= 3);
    }
  }

  function updateHud() {
    const scoreEl = container.querySelector('[data-role="score"]');
    if (scoreEl) {
      scoreEl.textContent = state.score;
    }
    const livesEl = container.querySelector('[data-role="lives"]');
    if (livesEl) {
      livesEl.innerHTML = `${heartsHtml()}${livesTextHtml()}`;
    }
  }

  function announceAnswer() {
    const statusEl = container.querySelector('[data-role="answer-status"]');
    if (statusEl) {
      statusEl.textContent = state.answerStatus;
    }
  }

  // Bildfehler nur für die aktuell gerenderte, noch unbeantwortete Runde:
  // Der Handler ist an den Runden-Token gebunden; ein später eintreffender
  // Fehler eines alten Bildes kann weder Runde noch Game-over überschreiben.
  function createImageErrorHandler(token) {
    return () => {
      if (state.disposed || token !== state.roundToken) {
        return;
      }
      if (!state.current || state.current.answered) {
        return;
      }
      if (state.screen !== "round") {
        return;
      }
      cancelScheduled();
      state.roundToken += 1;
      state.imageFails += 1;
      if (state.imageFails > 8) {
        state.screen = "fetch-error";
        container.innerHTML = renderSourceError();
        return;
      }
      nextRound();
    };
  }

  /* ---- Rendering ---- */

  function renderStart(focusFirstCard) {
    state.screen = "start";
    const title = escapeHtml((state.config && state.config.titel) || "Bilder-Rätsel");
    const cards = DIFFICULTIES.map(
      (d) => `
      <button type="button" class="oda-diff-card" data-diff="${escapeHtml(d.id)}">
        <span class="oda-diff-name">${escapeHtml(d.label)}</span>
        <span class="oda-diff-hint">${escapeHtml(d.hint)}</span>
        <span class="oda-diff-best">Beste: <strong>${getBest(d.id)}</strong></span>
      </button>`,
    ).join("");
    const warning =
      state.discarded > 0
        ? `<p class="oda-data-warning" role="status">${state.discarded} Datensätze wurden wegen fehlerhafter Struktur übersprungen.</p>`
        : "";

    container.innerHTML = `
    <section class="oda-game oda-start">
      <p class="oda-eyebrow">Foto-Quiz</p>
      <h1 class="oda-start-title">${title}</h1>
      <p class="oda-lead">Foto einer Sehenswürdigkeit erkennen und aus zwei Namen den
        richtigen wählen. Wähle eine Schwierigkeit – Leben und Zeit passen sich automatisch an.</p>
      ${warning}
      <div class="oda-difficulties">${cards}</div>
      ${themeToggleHtml()}
    </section>
  `;

    container.querySelectorAll(".oda-diff-card").forEach((card) => {
      card.addEventListener("click", () => {
        startGame(DIFFICULTIES.find((d) => d.id === card.dataset.diff));
      });
    });
    container.querySelectorAll(".oda-theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => setTheme(btn.dataset.theme));
    });

    if (focusFirstCard) {
      const first = container.querySelector(".oda-diff-card");
      if (first) {
        first.focus();
      }
    }
  }

  function renderRound() {
    state.screen = "round";
    const { solution, options } = state.current;
    const token = state.roundToken;
    const categoryChip = solution.category
      ? `<span class="oda-cat-chip">${escapeHtml(solution.category)}</span>`
      : "";
    const attribution = renderAttribution(solution);

    container.innerHTML = `
    <section class="oda-game">
      ${hudHtml()}
      <div class="oda-stage">
        <img class="oda-photo" src="${escapeHtml(solution.image)}" alt="Foto einer Sehenswürdigkeit" loading="lazy">
        ${categoryChip}
      </div>
      ${attribution}
      <p class="oda-question" aria-live="polite">Welche Sehenswürdigkeit siehst du?</p>
      <div class="oda-answers">
        <button type="button" class="oda-answer-btn" data-name="${escapeHtml(options[0])}">
          <span class="oda-key" aria-hidden="true">1</span>${escapeHtml(options[0])}
        </button>
        <span class="oda-or">oder</span>
        <button type="button" class="oda-answer-btn" data-name="${escapeHtml(options[1])}">
          <span class="oda-key" aria-hidden="true">2</span>${escapeHtml(options[1])}
        </button>
      </div>
      <p class="oda-answer-status" data-role="answer-status" aria-live="polite"></p>
    </section>
  `;

    const photo = container.querySelector(".oda-photo");
    if (photo) {
      photo.addEventListener("error", createImageErrorHandler(token));
    }
    container.querySelectorAll(".oda-answer-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAnswer(btn.dataset.name, btn));
    });

    const first = container.querySelector(".oda-answer-btn");
    if (first) {
      first.focus();
    }
  }

  // Autor und Lizenz immer zusammen sinnvoll: nur Autor, nur Lizenz oder beides.
  function renderAttribution(poi) {
    const parts = [];
    if (poi.author) {
      parts.push(`Foto: ${escapeHtml(poi.author)}`);
    }
    if (poi.licenseUrl) {
      parts.push(
        `<a href="${escapeHtml(poi.licenseUrl)}" target="_blank" rel="noopener">${escapeHtml(poi.license || "Bildlizenz")}</a>`,
      );
    } else if (poi.license) {
      parts.push(escapeHtml(poi.license));
    }
    if (!parts.length) {
      return "";
    }
    return `<p class="oda-attribution">${parts.join(" · ")}</p>`;
  }

  function renderGameOver() {
    if (state.disposed) {
      return;
    }
    cancelScheduled();
    state.roundToken += 1;
    state.screen = "gameover";
    const difficulty = state.difficulty || DIFFICULTIES[0];
    const isRecord = state.score > 0 && state.score > state.prevBest;
    if (state.score > getBest(difficulty.id)) {
      saveBest(difficulty.id, state.score);
    }
    const confetti = isRecord ? confettiHtml() : "";
    const title = isRecord ? "Neuer Rekord!" : "Spiel beendet";
    const solutionName = state.current ? state.current.solution.name : "";

    container.innerHTML = `
    <section class="oda-game oda-gameover">
      ${confetti}
      <p class="oda-eyebrow">${escapeHtml(difficulty.label)}</p>
      <h2 class="oda-result-title${isRecord ? " is-record" : ""}" tabindex="-1">${title}</h2>
      <p class="oda-hud-label">Punkte</p>
      <p class="oda-final-streak">${state.score}</p>
      <p class="oda-solution">Gesucht war: <strong>${escapeHtml(solutionName)}</strong><br>
        Bestwert (${escapeHtml(difficulty.label)}): <strong>${getBest(difficulty.id)}</strong></p>
      <div class="oda-actions">
        <button type="button" class="oda-btn" data-action="again">Nochmal spielen</button>
        <button type="button" class="oda-btn oda-btn-ghost" data-action="home">Zurück zur Startseite</button>
      </div>
    </section>
  `;

    const again = container.querySelector('[data-action="again"]');
    if (again) {
      again.addEventListener("click", () => startGame(difficulty));
    }
    const home = container.querySelector('[data-action="home"]');
    if (home) {
      home.addEventListener("click", goToStart);
    }

    const heading = container.querySelector(".oda-result-title");
    if (heading) {
      heading.focus();
    }
  }

  function hudHtml() {
    const difficulty = state.difficulty || DIFFICULTIES[0];
    const timer = difficulty.timer
      ? `<div class="oda-hud-item oda-hud-timer">
         <span class="oda-hud-label">Zeit</span>
         <span class="oda-hud-value"><span data-role="timer-value">${difficulty.timer}</span>s</span>
         <span class="oda-timer-track"><span class="oda-timer-bar" data-role="timer-bar"></span></span>
       </div>`
      : "";
    return `
    <div class="oda-hud">
      <div class="oda-hud-item">
        <span class="oda-hud-label">Punkte</span>
        <span class="oda-hud-value" data-role="score">${state.score}</span>
      </div>
      ${timer}
      <div class="oda-hud-item oda-hud-right">
        <span class="oda-hud-label">Leben</span>
        <span class="oda-hud-value oda-lives-value" data-role="lives" aria-live="polite">${heartsHtml()}${livesTextHtml()}</span>
      </div>
    </div>
  `;
  }

  function heartsHtml() {
    const total = state.difficulty ? state.difficulty.lives : 0;
    let out = "";
    for (let i = 0; i < total; i += 1) {
      out += `<span class="oda-heart${i < state.lives ? "" : " is-lost"}" aria-hidden="true">♥</span>`;
    }
    return `<span class="oda-hearts" aria-hidden="true">${out}</span>`;
  }

  function livesTextHtml() {
    const total = state.difficulty ? state.difficulty.lives : 0;
    return `<span class="visually-hidden" data-role="lives-text">${state.lives} von ${total} Leben verbleiben</span>`;
  }

  function confettiHtml() {
    // Gemischte Grautöne, damit das Konfetti in hellem und dunklem Modus sichtbar ist.
    const colors = ["#9ca3af", "#4b5563", "#d1d5db", "#6b7280", "#e5e7eb"];
    let out = "";
    for (let i = 0; i < 18; i += 1) {
      const left = Math.round(Math.random() * 100);
      const color = colors[i % colors.length];
      const delay = (Math.random() * 0.6).toFixed(2);
      const dur = (1.6 + Math.random() * 1.2).toFixed(2);
      out += `<i style="left:${left}%;background:${color};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
    }
    return `<div class="oda-confetti" aria-hidden="true">${out}</div>`;
  }

  /* ---- Bestwerte (localStorage, robust gegen deaktivierten Speicher) ---- */

  function getBest(difficultyId) {
    const value = state.highscore[difficultyId];
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function saveBest(difficultyId, score) {
    state.highscore[difficultyId] = score;
    try {
      window.localStorage.setItem(HIGHSCORE_KEY, JSON.stringify(state.highscore));
    } catch (_error) {
      // Speicher nicht verfügbar (z. B. privater Modus) – Bestwert bleibt sitzungslokal.
    }
  }

  /* ---- Darstellung (Auto / Hell / Dunkel), gemerkt in localStorage ---- */

  // "auto" folgt der OS-Einstellung (kein Attribut); "light"/"dark" erzwingen
  // die Wahl. Das Attribut gehört zum App-Container, nie zum Dokument.
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") {
      container.setAttribute("data-oda-theme", mode);
    } else {
      container.removeAttribute("data-oda-theme");
    }
  }

  function setTheme(mode) {
    const value = THEME_MODES.includes(mode) ? mode : "auto";
    try {
      window.localStorage.setItem(THEME_KEY, value);
    } catch (_error) {
      // Speicher nicht verfügbar – Wahl bleibt sitzungslokal.
    }
    applyTheme(value);
    renderStart(false);
  }

  function themeToggleHtml() {
    const current = readTheme();
    const buttons = THEME_MODES.map(
      (mode) =>
        `<button type="button" class="oda-theme-btn${mode === current ? " is-active" : ""}" data-theme="${mode}">${THEME_LABELS[mode]}</button>`,
    ).join("");
    return `<div class="oda-theme" role="group" aria-label="Darstellung">${buttons}</div>`;
  }

  /* ---- UI-Zustände: Laden / Konfiguration / Fehler / leer / Qualität ---- */

  function renderLoading() {
    return `
    <section class="oda-game oda-loading">
      <div class="oda-spinner" role="status" aria-hidden="true"></div>
      <p>Sehenswürdigkeiten werden geladen …</p>
    </section>
  `;
  }

  function renderConfigError() {
    return `
    <section class="oda-game">
      <div class="oda-error" role="alert">
        <h2>Keine gültige Datenquelle konfiguriert</h2>
        <p>Es ist keine gültige Datenquelle konfiguriert. Bitte tragen Sie im ODAS-Editor eine
          HTTP(S)-Adresse einer offenen Datensatz- oder Ressourcen-URL ein.</p>
      </div>
    </section>
  `;
  }

  function renderSourceError() {
    return `
    <section class="oda-game">
      <div class="oda-error" role="alert">
        <h2>Die Daten konnten nicht geladen werden</h2>
        <p>Die Datenquelle ist derzeit nicht erreichbar oder liefert keine verarbeitbaren Daten.
          Bitte versuchen Sie es später erneut.</p>
      </div>
    </section>
  `;
  }

  // broken = true: Quelle erfolgreich gelesen, aber alle Zeilen waren fehlerhaft.
  function renderEmpty(broken) {
    const title = broken ? "Die Datenquelle ist defekt" : "Keine Daten gefunden";
    const message = broken
      ? "Alle Datensätze der Quelle wurden verworfen."
      : "Die Datenquelle enthält keine Datensätze.";
    return `
    <section class="oda-game">
      <div class="oda-empty" role="status">
        <h2>${title}</h2>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>
  `;
  }

  function renderQualityError() {
    return `
    <section class="oda-game">
      <div class="oda-error" role="alert">
        <h2>Datenqualität reicht nicht für ein Spiel</h2>
        <p>Die Datenquelle enthält nicht genügend Einträge mit Bild und mindestens zwei
          unterschiedliche Namen. Bitte prüfen Sie die Datenquelle.</p>
      </div>
    </section>
  `;
  }

  return { dispose, goToStart, start };
}

/* --------------------------------------------------------------------------
 * Quellmodus: ausschließlich die verpflichtend konfigurierte Portal-URL
 * ----------------------------------------------------------------------- */

// Liefert { kind: "remote", url, proxyEnabled } oder { kind: "config-error", reason }.
function resolveSource(configdata) {
  const raw = String((configdata && configdata.apiurl) || "").trim();
  if (!raw) {
    return { kind: "config-error", reason: "empty" };
  }
  if (raw.includes("{{")) {
    return { kind: "config-error", reason: "unresolved-placeholder" };
  }
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    return { kind: "config-error", reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "config-error", reason: "unsupported-scheme" };
  }
  return { kind: "remote", url: url.href, proxyEnabled: isOdasProxyEnabled(configdata) };
}

/* --------------------------------------------------------------------------
 * Parser: JSON oder CSV (PapaParse, vendort, Promise-geladen)
 * ----------------------------------------------------------------------- */

let papaParsePromise = null;

// Lädt PapaParse ausschließlich aus app/vendor/ – kein CDN, kein addToHead().
function ensurePapaParse() {
  if (!papaParsePromise) {
    papaParsePromise = new Promise((resolve, reject) => {
      if (typeof window.Papa !== "undefined") {
        resolve(window.Papa);
        return;
      }
      const script = document.createElement("script");
      script.src = "vendor/papaparse/papaparse.min.js";
      script.onload = () => {
        if (typeof window.Papa !== "undefined") {
          resolve(window.Papa);
        } else {
          reject(new Error("PapaParse konnte nicht geladen werden."));
        }
      };
      script.onerror = () => reject(new Error("PapaParse konnte nicht geladen werden."));
      document.head.appendChild(script);
    });
  }
  return papaParsePromise;
}

// Liefert { records, discarded, warnings, format }. Eine leere, erfolgreich
// gelesene Quelle ergibt records: [] ohne Parserfehler.
async function parseSource(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { records: [], discarded: 0, warnings: [], format: "" };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonSource(trimmed);
  }
  return parseCsvSource(text);
}

// Unterstützte JSON-Hüllen: Array, result.records, records, results, result, data.
// Eine unbekannte Hülle ist ein Parserfehler, niemals ein leeres Ergebnis.
function parseJsonSource(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    throw new Error("Die Datenquelle ist kein gültiges JSON.");
  }

  let records;
  if (Array.isArray(json)) {
    records = json;
  } else if (json && typeof json === "object") {
    const candidates = [
      json.result && json.result.records,
      json.records,
      json.results,
      json.result,
      json.data,
    ];
    records = candidates.find(Array.isArray);
  }
  if (!records) {
    throw new Error("Die JSON-Struktur der Datenquelle wird nicht unterstützt.");
  }

  const warnings = [];
  const kept = [];
  let discarded = 0;
  for (const item of records) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      kept.push(item);
    } else {
      discarded += 1;
      warnings.push("Nicht-Objekt-Eintrag übersprungen.");
    }
  }
  return { records: kept, discarded, warnings, format: "json" };
}

// PapaParse: header: true, skipEmptyLines: "greedy", Delimiter-Autoerkennung,
// transformHeader entfernt BOM/Whitespace. FieldMismatch-Zeilen werden gezählt
// und verworfen; leere oder doppelte Header sind strukturelle Fehler.
async function parseCsvSource(text) {
  const Papa = await ensurePapaParse();
  validateCsvHeaderRow(Papa, text);

  const records = [];
  const warnings = [];
  let discarded = 0;
  let fields = null;

  await new Promise((resolve, reject) => {
    let fatalProblem = null;
    try {
      Papa.parse(String(text), {
        header: true,
        skipEmptyLines: "greedy",
        delimiter: "",
        transformHeader: (header) => String(header).replace(/^\uFEFF/, "").trim(),
        step: (results) => {
          fields = (results.meta && results.meta.fields) || fields;
          const mismatches = (results.errors || []).filter((e) => e.type === "FieldMismatch");
          if (mismatches.length) {
            discarded += 1;
            warnings.push(`Zeile übersprungen: ${mismatches[0].message}`);
          } else if (results.data && typeof results.data === "object") {
            records.push(results.data);
          }
          const structural = (results.errors || []).find(
            (e) => e.type !== "FieldMismatch" && e.code !== "UndetectableDelimiter",
          );
          if (structural) {
            fatalProblem = fatalProblem || new Error(`CSV-Parserfehler: ${structural.message}`);
          }
        },
        complete: () => resolve(),
        error: (err) => {
          fatalProblem = fatalProblem || new Error(`CSV-Parserfehler: ${err.message}`);
          resolve();
        },
      });
    } catch (parseThrown) {
      fatalProblem = fatalProblem || new Error(`CSV-Parserfehler: ${parseThrown.message}`);
      resolve();
    }
    if (fatalProblem) {
      reject(fatalProblem);
    }
  });

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Die CSV-Quelle enthält keine Spaltenüberschriften.");
  }
  return { records, discarded, warnings, format: "csv" };
}

// Leere, doppelte oder fehlende Spaltenüberschriften sind strukturelle Fehler.
// Die Roh-Headerzeile wird separat mit preview: 1 gelesen, weil PapaParse die
// transformHeader-Funktion pro Zeile erneut aufruft (keine Zählung dort möglich).
function validateCsvHeaderRow(Papa, text) {
  const preview = Papa.parse(String(text), { preview: 1, skipEmptyLines: "greedy" });
  const headerRow = (preview.data && preview.data[0]) || [];
  if (!headerRow.length) {
    throw new Error("Die CSV-Quelle enthält keine Spaltenüberschriften.");
  }
  const seen = new Set();
  for (const raw of headerRow) {
    const cleaned = String(raw).replace(/^\uFEFF/, "").trim();
    if (!cleaned) {
      throw new Error("Die CSV-Quelle enthält eine leere Spaltenüberschrift.");
    }
    if (seen.has(cleaned)) {
      throw new Error(`Die CSV-Quelle enthält doppelte Spaltenüberschrift („${cleaned}“).`);
    }
    seen.add(cleaned);
  }
}

/* --------------------------------------------------------------------------
 * Datenaufbereitung (feldtolerant für schema.org/ODTA-Varianten)
 * ----------------------------------------------------------------------- */

function buildPools(records) {
  const pois = [];
  const nameSet = new Set();
  (records || []).forEach((rec, index) => {
    const poi = normalizePoi(rec, index);
    if (!poi.name) {
      return;
    }
    pois.push(poi);
    nameSet.add(poi.name);
  });
  const imagePois = pois.filter((p) => p.image);
  return { imagePois, pois, names: Array.from(nameSet) };
}

function normalizePoi(rec, index) {
  const license = pickLicense(rec);
  return {
    id: String(rec["@id"] || rec.identifier || pickName(rec.name) || index),
    name: pickName(rec.name),
    category: formatCategory(rec.bayernCloudType || rec.category || ""),
    image: safeHttpUrl(pickImage(rec)),
    author: pickAuthor(rec),
    license: license.text,
    licenseUrl: safeHttpUrl(license.url),
  };
}

// Name kann String oder ein mehrsprachiges Objekt/Array sein.
function pickName(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.length ? pickName(value[0]) : "";
  }
  if (typeof value === "object") {
    for (const lang of ["de", "de-DE", "en"]) {
      if (value[lang]) {
        return pickName(value[lang]);
      }
    }
    const first = Object.values(value).find((v) => typeof v === "string" && v.trim());
    return first ? first.trim() : "";
  }
  return String(value);
}

// Bild kann flach (image-contentUrl) oder verschachtelt (image als String,
// Objekt {contentUrl|url} oder Array davon) vorliegen.
function pickImage(rec) {
  const flat = rec["image-contentUrl"];
  if (typeof flat === "string" && flat.trim()) {
    return flat.trim();
  }
  const img = rec.image;
  if (!img) {
    return "";
  }
  if (typeof img === "string") {
    return img.trim();
  }
  if (Array.isArray(img)) {
    for (const item of img) {
      const url = pickImage({ image: item });
      if (url) {
        return url;
      }
    }
    return "";
  }
  if (typeof img === "object") {
    return String(img.contentUrl || img.url || "").trim();
  }
  return "";
}

// Bildautor:in aus flachen oder verschachtelten Feldern.
function pickAuthor(rec) {
  const flat = [rec["image-author-givenName"], rec["image-author-familyName"]]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (flat) {
    return flat;
  }
  if (typeof rec["image-author"] === "string" && rec["image-author"].trim()) {
    return rec["image-author"].trim();
  }
  const img = rec.image;
  const author = img && !Array.isArray(img) && typeof img === "object" ? img.author : null;
  if (author) {
    if (typeof author === "string") {
      return author;
    }
    if (author.name) {
      return String(author.name);
    }
    const nm = [author.givenName, author.familyName].filter(Boolean).join(" ");
    if (nm) {
      return nm;
    }
  }
  return "";
}

// Bildlizenz aus flachem image-license oder verschachteltem image.license.
// Ist der Wert eine sichere HTTP(S)-URL, wird sie als Link gerendert und das
// Label aus dem bekannten URL-Pfad abgeleitet; sonst bleibt es Text.
function pickLicense(rec) {
  const flat = rec["image-license"];
  if (typeof flat === "string" && flat.trim()) {
    return classifyLicense(flat.trim());
  }
  const img = rec.image;
  const license = img && !Array.isArray(img) && typeof img === "object" ? img.license : null;
  if (license == null) {
    return { text: "", url: "" };
  }
  if (typeof license === "string" && license.trim()) {
    return classifyLicense(license.trim());
  }
  if (typeof license === "object") {
    const url = license.url || license["@id"] || "";
    if (typeof url === "string" && url.trim()) {
      return classifyLicense(url.trim());
    }
    if (typeof license.name === "string" && license.name.trim()) {
      return { text: license.name.trim(), url: "" };
    }
  }
  return { text: "", url: "" };
}

function classifyLicense(value) {
  if (/^https?:\/\//i.test(value)) {
    return { text: licenseLabelFromUrl(value), url: value };
  }
  return { text: value, url: "" };
}

// Label aus bekanntem URL-Pfad ableiten (z. B. creativecommons.org/licenses/...),
// sonst neutral "Bildlizenz". Keine fest verdrahtete Host-Liste.
function licenseLabelFromUrl(url) {
  try {
    const parts = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    const idx = parts.indexOf("licenses");
    if (idx >= 0 && parts[idx + 1]) {
      const type = parts[idx + 1];
      const version = parts[idx + 2];
      if (type === "zero") {
        return version ? `CC0 ${version}` : "CC0";
      }
      if (type === "publicdomain" || type === "mark") {
        return "Public Domain";
      }
      const base = `CC ${type.toUpperCase()}`;
      return version ? `${base} ${version}` : base;
    }
    // creativecommons.org/publicdomain/zero/1.0/ (ohne /licenses/-Segment)
    if (parts[0] === "publicdomain" && parts[1] === "zero") {
      return parts[2] ? `CC0 ${parts[2]}` : "CC0";
    }
  } catch (_error) {
    // keine URL -> neutrales Label
  }
  return "Bildlizenz";
}

// "Ausstellung & Führungen::Kunst" -> "Ausstellung & Führungen – Kunst"
function formatCategory(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.split("::").join(" – ");
}

/* --------------------------------------------------------------------------
 * Sichere URLs: ausschließlich http:/https: für Daten-, Bild- und Lizenz-URLs
 * ----------------------------------------------------------------------- */

function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch (_error) {
    return "";
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
}

/* --------------------------------------------------------------------------
 * ODAS-Laufzeit-Helfer (kanonische Namen aus oda-generic)
 * ----------------------------------------------------------------------- */

function isOdasProxyEnabled(configdata = {}) {
  return String(configdata.proxyAktiv || "").trim().toLowerCase() === "ja";
}

function extractPathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname + parsedUrl.search;
  } catch (_error) {
    return String(url || "");
  }
}

function getOdasAppBasePath(pathname) {
  let appPath =
    pathname === undefined
      ? typeof window !== "undefined"
        ? window.location.pathname
        : "/"
      : String(pathname || "/");

  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }

  return appPath.replace(/\/+$/, "");
}

function getOdasProxyEndpoint(targetUrl, pathname) {
  const appPath = getOdasAppBasePath(pathname);
  return `${appPath}/odp-data?path=${encodeURIComponent(
    extractPathFromUrl(targetUrl),
  )}`;
}

async function fetchViaOdasProxy(targetUrl) {
  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}`);
  }

  const responseText = await response.text();
  try {
    const proxyData = JSON.parse(responseText);
    if (proxyData && typeof proxyData.content === "string") {
      return proxyData.content;
    }
  } catch (_error) {
    // Transparente CSV-/Text-Antwort des Proxys: unten unverändert weitergeben.
  }

  return responseText;
}

async function fetchOdasResource(targetUrl, configdata = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl);
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle oder aktivieren Sie den ODAS-Proxy.`,
    );
  }
}

/* --------------------------------------------------------------------------
 * Bestwerte / Darstellung – Instanz-übergreifende Speicherzugriffe
 * ----------------------------------------------------------------------- */

function readHighscores() {
  try {
    const raw = window.localStorage.getItem(HIGHSCORE_KEY);
    if (!raw) {
      return {};
    }
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch (_error) {
    return {};
  }
}

function readTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return THEME_MODES.includes(value) ? value : "auto";
  } catch (_error) {
    return "auto";
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/*
 * Diese Funktion kann Bibliotheken und benötigte Skripte laden.
 */
function addToHead() {}
