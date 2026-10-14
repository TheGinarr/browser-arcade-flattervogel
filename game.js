/* ============================================================
   FLATTERVOGEL · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Zustand: Der Vogel hat eine Höhe (y) und eine Geschwindigkeit
      (vy, positiv = fällt). Dazu kommen eine Liste von Säulenpaaren,
      der Punktestand und eine "phase" (bereit / laeuft / pause /
      vorbei) als einfache Zustandsmaschine.
   2. Physik: Jeden Schritt zieht die Gravitation an vy, vy verschiebt
      y. Ein Flügelschlag setzt vy auf einen festen negativen Wert
      (= Impuls nach oben). Mehr Physik gibt es nicht, der Rest ist
      Gefühl: Gravitation und Impuls müssen "zueinander passen".
   3. Welt statt Vogel bewegt sich: Der Vogel bleibt bei x = 100,
      die Säulenpaare wandern nach links. Das macht die Kollision
      einfach, weil sich am Vogel nur y ändert.
   4. Spielschleife: requestAnimationFrame ruft einzelbild() einmal
      pro Frame auf. Die Physik läuft in festen Schritten von 1/240 s
      (Muster "Akkumulator" wie bei Snake), damit der Flug auf jedem
      Gerät gleich aussieht.
   5. Kollision (der Lernkern): Der Vogel ist ein KREIS, die Säulen
      sind RECHTECKE. kreisTrifftRechteck() in logik.js sucht den Punkt
      des Rechtecks, der dem Kreismittelpunkt am nächsten liegt, und
      vergleicht seinen Abstand mit dem Radius. Alles Rechnerische
      (Physik, Kollision, Säulen erzeugen) steht in logik.js und lässt
      sich ohne Browser testen. Hier liegen Eingabe, Schleife, Zeichnen.
   6. Ende: Bei einem Treffer blitzt das Feld kurz auf, der Vogel
      stürzt ab, danach übernimmt gameOverDialog() aus ui.js
      (Initialen, Topliste, "Nochmal").
   ============================================================ */

import { topliste, spielZuruecksetzen } from "./assets/storage.js";
import { bewegungReduziert, gameOverDialog, toplisteAnzeigen } from "./assets/ui.js";
import { spielSeite, text, TASTE, ansage } from "./assets/mobil.js";
import { levelWahl } from "./assets/levelwahl.js";
import {
  BREITE,
  HOEHE,
  BODEN_Y,
  VOGEL_X,
  START_Y,
  VOGEL_RADIUS_BILD,
  VOGEL_RADIUS_HIT,
  tempoFuerPunkte,
  neuerVogel,
  fluegelschlag,
  vogelSchritt,
  neigung,
  saeulenRechtecke,
  kollisionsGrund,
  paarPassiert,
  neuesPaar,
  naechsterPaarAbstand,
  ABSCHNITTE,
  abschnittIndex,
  schwingMitte,
} from "./logik.js";

/* ---------- Konstanten (Stellschrauben des Spiels) ---------- */
const SPIEL = "flattervogel"; // Schlüssel für den Speicher (storage.js)
const SCHRITT = 1 / 240; // Physik-Zeitschritt in Sekunden (fest!)
const MAX_FRAME_ABSTAND_MS = 250; // siehe einzelbild()
const BLITZ_DAUER_MS = 650; // Länge des Aufblitzens nach dem Treffer
const SPAWN_LINIE = BREITE + 40; // ab hier (knapp rechts außerhalb) entstehen neue Säulenpaare
const SCHWEBE_AMPLITUDE = 8; // Auf und Ab des wartenden Vogels (Pixel)
const SCHLAG_DAUER = 0.3; // Sekunden für einen kompletten Flügelschlag
const SPERRE_NACH_DIALOG_MS = 700; // siehe dialogEntschaerfen()

const TASTEN_FLATTERN = new Set([" ", "arrowup", "w"]);

/* ---------- Elemente der Seite ---------- */
const leinwand = document.getElementById("leinwand");
// zeichner ist "let": Die Szene entsteht auf einem halb so großen Canvas und
// wird ohne Glätten hochskaliert (Pixel-Look). Texte kommen danach scharf dazu.
const hauptZ = leinwand.getContext("2d");
let zeichner = hauptZ;
const PIXEL_RASTER = 0.5;
const pixelLeinwand = document.createElement("canvas");
pixelLeinwand.width = 360 * PIXEL_RASTER;
pixelLeinwand.height = 540 * PIXEL_RASTER;
const pixelZ = pixelLeinwand.getContext("2d");
const hudPunkte = document.getElementById("hud-punkte");
const hudRekord = document.getElementById("hud-rekord");
const hudAbschnitt = document.getElementById("hud-abschnitt");
const toplisteBox = document.getElementById("topliste");
const resetKnopf = document.getElementById("reset");

// Das Canvas hat intern immer 360x540 Pixel. CSS skaliert es nur.
leinwand.width = BREITE;
leinwand.height = HOEHE;
// Sonst würde der Browser bei Berührungen auf dem Spielfeld scrollen/zoomen.
leinwand.style.touchAction = "none";

/* ---------- Farben aus dem Design lesen ----------
   Die Farben kommen aus den CSS-Variablen von style.css. Ändert sich das
   Design, passt sich das Spielfeld automatisch an. Das zweite Argument
   ist ein Notnagel, falls eine Variable leer sein sollte. */
const bodyStil = getComputedStyle(document.body);
function lesFarbe(name, notfall) {
  return bodyStil.getPropertyValue(name).trim() || notfall;
}

/** Mischt eine #rrggbb-Farbe mit Weiß (0 = unverändert, 1 = weiß). */
function mischeMitWeiss(farbe, anteil) {
  const treffer = /^#([0-9a-f]{6})$/i.exec(farbe);
  if (!treffer) return farbe;
  const zahl = parseInt(treffer[1], 16);
  // Ein 24-Bit-Wert besteht aus drei Bytes (Rot, Grün, Blau). Mit
  // Bit-Verschiebung (>>) und Maske (& 255) holen wir sie einzeln heraus.
  const kanaele = [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255].map((k) =>
    Math.round(k + (255 - k) * anteil),
  );
  return `rgb(${kanaele.join(",")})`;
}

const farben = {
  hintergrund: lesFarbe("--bg", "#07070f"),
  flaeche: lesFarbe("--panel", "#111124"),
  flaeche2: lesFarbe("--panel2", "#181834"),
  linie: lesFarbe("--line", "#2b2b52"),
  vogel: lesFarbe("--pink", "#ff2d78"),
  saeule: lesFarbe("--cyan", "#00e5ff"),
  schnabel: lesFarbe("--gold", "#ffc84d"),
  text: lesFarbe("--txt", "#eef0ff"),
  gedaempft: lesFarbe("--mut", "#9aa0c6"),
  schriftPixel: lesFarbe("--pixel", "monospace"),
  schriftText: lesFarbe("--sans", "sans-serif"),
};
farben.vogelHell = mischeMitWeiss(farben.vogel, 0.45);
farben.saeuleHell = mischeMitWeiss(farben.saeule, 0.55);

/* ---------- Spielzustand ---------- */
let vogel; // { y, vy } aus logik.js
let paare; // [{ x, mitteY, luecke, gewertet }, …]
let naechstesPaarX; // Weltposition, an der das nächste Paar entsteht (wandert nach links)
let vorherigeMitte; // Lückenmitte des letzten Paars (für fairen Höhenverlauf)
let punkte;
let strecke; // gesamte Strecke der Welt in Pixeln (für Boden und Parallaxe)
let schlagZeit; // Sekunden seit dem letzten Flügelschlag (steuert die Flügel-Animation)
let rekordGespeichert = 0;
let rekordGepulst; // Puls nur einmal pro Spiel
let phase; // "bereit" | "laeuft" | "pause" | "vorbei"
let abschnitt = 0; // Index in ABSCHNITTE
let startAbschnitt = 0; // in der Auswahl gewählter Start-Abschnitt
let flugzeit = 0; // Sekunden seit Start (für das Schwingen der Säulen)
let himmelVon = 0,
  himmelWechsel = 0; // für den weichen Übergang der Tageszeit
let banner = "",
  bannerBis = 0;

/* Himmel je Abschnitt: Verlauf oben -> unten und ob Sterne zu sehen sind.
   Im Spielfeld gilt die Tageszeit, außerhalb das Neon-Design. */
const HIMMEL = [
  { oben: "#2a1d4a", unten: "#b05a6a", sterne: 0.5 },
  { oben: "#1b4f8a", unten: "#6fb1d8", sterne: 0 },
  { oben: "#24557e", unten: "#9cc7cf", sterne: 0 },
  { oben: "#3a1846", unten: "#e0784a", sterne: 0.25 },
  { oben: "#05050f", unten: "#141436", sterne: 1 },
];
let akkumulator = 0; // angesammelte, noch nicht "verbrauchte" Zeit in Sekunden
let letzteZeit = 0;
let blitzStart = 0;
let dialogGezeigt = false;
let partikel = []; // Federn und Funken (reine Deko)
let ruhigerModus = bewegungReduziert();

/* ============================================================
   HUD
   ============================================================ */

function saeulenText(anzahl) {
  return anzahl === 1 ? "1 Säule" : `${anzahl} Säulen`;
}

function toplisteAktualisieren() {
  const liste = topliste(SPIEL);
  rekordGespeichert = liste.length > 0 ? liste[0].punkte : 0;
  toplisteAnzeigen(toplisteBox, SPIEL, saeulenText);
}

/** Rekord "live": Sobald die aktuellen Punkte ihn übertreffen, zieht er mit. */
function rekordLive() {
  return Math.max(rekordGespeichert, punkte);
}

function hudAktualisieren() {
  hudPunkte.textContent = String(punkte);
  hudRekord.textContent = String(rekordLive());
}

/** Kurzer Puls am Rekordfeld, genau in dem Moment, in dem er geknackt wird. */
function rekordPulsen() {
  hudRekord.classList.remove("rekord-puls");
  void hudRekord.offsetWidth; // erzwingt Neuberechnung des Layouts, damit die Animation neu startet
  hudRekord.classList.add("rekord-puls");
  hudRekord.addEventListener("animationend", () => hudRekord.classList.remove("rekord-puls"), {
    once: true,
  });
}

/* ============================================================
   Spielablauf
   ============================================================ */

/** Setzt alles auf Anfang. Wird beim Laden und bei "Nochmal" aufgerufen. */
function neuesSpiel(ab = startAbschnitt) {
  startAbschnitt = ab;
  abschnitt = ab;
  himmelVon = ab;
  himmelWechsel = -10;
  flugzeit = 0;
  hudAbschnitt.textContent = String(ab + 1);
  wahl.aktiv(ab + 1);
  vogel = neuerVogel();
  paare = [];
  punkte = 0;
  strecke = 0;
  schlagZeit = 10; // "lange her": Flügel in Ruhestellung
  rekordGepulst = false;
  partikel = [];
  akkumulator = 0;
  dialogGezeigt = false;
  phase = "bereit";

  // Das erste Paar entsteht gleich hinter der Spawn-Linie, also noch
  // außerhalb des Bildes. Bis es den Vogel erreicht, vergehen ca. 2 s.
  naechstesPaarX = SPAWN_LINIE;
  vorherigeMitte = null;
  paareNachlegen();

  toplisteAktualisieren();
  hudAktualisieren();
}

/**
 * Legt neue Säulenpaare an, solange die Spawn-Linie (knapp rechts außerhalb
 * des Bildes) erreicht ist. `naechstesPaarX` wandert wie alles andere
 * mit der Welt nach links. Ist es an der Linie angekommen, entsteht dort das
 * Paar, und der Platz für das übernächste wird um einen Abstand weiter
 * rechts vorgemerkt. So entsteht der Abstand exakt, egal wie viele Frames
 * dazwischen vergangen sind.
 */
function paareNachlegen() {
  while (naechstesPaarX <= SPAWN_LINIE) {
    const paar = neuesPaar(naechstesPaarX, vorherigeMitte, Math.random, ABSCHNITTE[abschnitt]);
    vorherigeMitte = paar.basisMitte;
    paare.push(paar);
    // Der Abstand richtet sich nach dem aktuellen Tempo (Begründung bei
    // naechsterPaarAbstand() in logik.js).
    naechstesPaarX += naechsterPaarAbstand(tempoFuerPunkte(punkte), Math.random());
  }
}

/** Ein Physikschritt von genau SCHRITT Sekunden. */
function schritt() {
  const tempo = tempoFuerPunkte(punkte);

  vogelSchritt(vogel, SCHRITT);
  schlagZeit += SCHRITT;
  flugzeit += SCHRITT;
  // Schwingende Säulen: Lückenmitte folgt einer Sinuskurve
  for (const paar of paare) paar.mitteY = schwingMitte(paar, flugzeit);

  // Welt nach links schieben
  strecke += tempo * SCHRITT;
  for (const paar of paare) paar.x -= tempo * SCHRITT;
  naechstesPaarX -= tempo * SCHRITT;
  paare = paare.filter((paar) => paar.x > -120); // links aus dem Bild: entsorgen
  paareNachlegen();

  // Punkte: +1, sobald die Mitte eines Paars am Vogel vorbei ist
  for (const paar of paare) {
    if (!paar.gewertet && paarPassiert(paar)) {
      paar.gewertet = true;
      punkte += 1;
      hudAktualisieren();
      const neu = abschnittIndex(punkte, startAbschnitt);
      if (neu !== abschnitt) {
        himmelVon = abschnitt;
        himmelWechsel = flugzeit;
        abschnitt = neu;
        hudAbschnitt.textContent = String(abschnitt + 1);
        banner = ABSCHNITTE[abschnitt].name.toUpperCase();
        bannerBis = flugzeit + 2;
        wahl.erreicht(abschnitt + 1);
        wahl.aktiv(abschnitt + 1);
        ansage(`Abschnitt ${abschnitt + 1}: ${ABSCHNITTE[abschnitt].name}`);
      }
      if (!rekordGepulst && rekordGespeichert > 0 && punkte > rekordGespeichert) {
        rekordGepulst = true;
        if (!ruhigerModus) rekordPulsen();
      }
    }
  }

  // Kollision: Säule, Boden oder Decke
  if (kollisionsGrund(vogel, paare)) spielBeenden();
}

function spielBeenden() {
  phase = "vorbei";
  blitzStart = performance.now();
  funkenErzeugen();
  hudAktualisieren();
  // Wer Bewegung reduziert haben möchte, bekommt keinen Blitz: sofort Dialog.
  if (ruhigerModus) dialogAnzeigen();
}

function dialogAnzeigen() {
  if (dialogGezeigt) return;
  dialogGezeigt = true;
  const dialog = gameOverDialog({
    spiel: SPIEL,
    punkte,
    punkteText: saeulenText(punkte),
    richtung: "hoch", // beim Flattervogel ist MEHR besser
    format: saeulenText,
    neustart: neuesSpiel,
  });
  dialogEntschaerfen(dialog);
  // Auch beim Schließen mit Esc (ohne "Nochmal") soll die Seite den neuen Stand zeigen.
  dialog.addEventListener("close", () => {
    toplisteAktualisieren();
    hudAktualisieren();
  });
}

/**
 * Schützt vor "Durchrutschen": Wer beim Sterben gerade wild Leertaste
 * drückt oder aufs Handy tippt (bei diesem Spiel völlig normal!), würde
 * den Dialog sonst sofort wieder wegklicken, noch bevor man sein Ergebnis
 * gesehen oder Initialen eingetragen hat. Deshalb ignoriert der Dialog
 * für eine kurze Zeit alle Tasten- und Zeiger-Eingaben.
 */
function dialogEntschaerfen(dialog) {
  const bis = performance.now() + SPERRE_NACH_DIALOG_MS;
  const sperren = (ereignis) => {
    if (performance.now() < bis && document.getElementById("spiel-dialog")) {
      ereignis.preventDefault();
      ereignis.stopPropagation();
    }
  };
  // Capture-Phase (true): Wir sind vor dem Knopf an der Reihe.
  document.addEventListener("keydown", sperren, true);
  document.addEventListener("keyup", sperren, true);
  dialog.style.pointerEvents = "none";
  setTimeout(() => {
    dialog.style.pointerEvents = "";
    document.removeEventListener("keydown", sperren, true);
    document.removeEventListener("keyup", sperren, true);
  }, SPERRE_NACH_DIALOG_MS);
}

/* ---------- Pause ---------- */

function pauseUmschalten() {
  if (phase === "laeuft") phase = "pause";
  else if (phase === "pause") phase = "laeuft";
}

/**
 * Flügelschlag gewünscht (Taste, Klick oder Tippen). Je nach Phase:
 * Spiel starten, flattern, weitermachen oder (nach Esc im Dialog) neu beginnen.
 */
function flattern() {
  if (phase === "bereit") {
    phase = "laeuft"; // der erste Schlag startet die Runde
    akkumulator = 0;
    schlagen();
  } else if (phase === "laeuft") {
    schlagen();
  } else if (phase === "pause") {
    phase = "laeuft";
  } else if (phase === "vorbei" && dialogGezeigt && !document.getElementById("spiel-dialog")) {
    neuesSpiel();
  }
}

function schlagen() {
  fluegelschlag(vogel);
  schlagZeit = 0;
  federnErzeugen();
}

/* ============================================================
   Eingabe
   ============================================================ */
document.addEventListener("keydown", (ereignis) => {
  // Browser-Kürzel (Strg+R, Cmd+W …) nicht stören.
  if (ereignis.ctrlKey || ereignis.metaKey || ereignis.altKey) return;
  // Offener Game-Over-Dialog: Dort tippt man Initialen.
  if (document.getElementById("spiel-dialog")) return;

  const ziel = ereignis.target;
  if (ziel instanceof HTMLElement && ziel.matches("input, textarea, select")) return;

  const taste = ereignis.key.toLowerCase();

  if (taste === "p") {
    if (phase === "laeuft" || phase === "pause") pauseUmschalten();
    return;
  }

  if (TASTEN_FLATTERN.has(taste)) {
    // Leertaste auf einem fokussierten Knopf/Link soll diesen bedienen
    // (Reset-Knopf, Zusammenklappbox), nicht das Spiel.
    if (taste === " " && ziel instanceof HTMLElement && ziel.matches("button, a, summary")) return;
    ereignis.preventDefault(); // Pfeil/Leertaste würden sonst scrollen
    // Gehaltene Taste = Auto-Wiederholung (ereignis.repeat). Das soll NICHT
    // im Sekundentakt flattern, jeder Schlag braucht einen eigenen Tastendruck.
    if (!ereignis.repeat) flattern();
  }
});

// pointerdown deckt Maus, Finger und Stift ab und reagiert sofort beim
// Aufsetzen, nicht erst beim Loslassen: Das fühlt sich direkter an.
leinwand.addEventListener("pointerdown", (ereignis) => {
  ereignis.preventDefault();
  flattern();
});

// Tab-Wechsel oder Fensterfokus weg: Das Spiel pausiert.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "laeuft") phase = "pause";
});
window.addEventListener("blur", () => {
  if (phase === "laeuft") phase = "pause";
});

/* ---------- Reset-Knopf ---------- */
resetKnopf.addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  wahl.neuLaden();
  toplisteAktualisieren(); // Liste leer, Rekord wieder 0
  hudAktualisieren();
  if (phase === "laeuft") phase = "pause"; // nicht im Hintergrund weiterspielen
  resetKnopf.blur(); // sonst würde die nächste Leertaste den Knopf drücken
});

/* ============================================================
   Hauptschleife
   ============================================================ */

/**
 * Wird vom Browser einmal pro Bildschirm-Frame aufgerufen.
 *
 * MUSTER "AKKUMULATOR / FESTER ZEITSCHRITT" (wie bei Snake):
 * Frames kommen je nach Gerät 30-, 60- oder 144-mal pro Sekunde. Wir sammeln
 * die vergangene Zeit im Akkumulator und verbrauchen sie in festen
 * Portionen von 1/240 Sekunde. So ist die Physik auf JEDEM Gerät dieselbe:
 * gleiche Flughöhe pro Flügelschlag, gleiche Fallkurve. Bei langsamen Frames
 * werden mehrere Schritte nachgeholt.
 */
function einzelbild(jetzt) {
  // Abstand begrenzen: Nach langer Pause (Tab im Hintergrund, Debugger)
  // wären sonst Hunderte Schritte auf einmal fällig.
  const abstandMs = Math.min(jetzt - letzteZeit, MAX_FRAME_ABSTAND_MS);
  letzteZeit = jetzt;
  ruhigerModus = bewegungReduziert(); // Nutzer kann die Einstellung jederzeit ändern

  if (phase === "laeuft") {
    akkumulator += abstandMs / 1000;
    while (phase === "laeuft" && akkumulator >= SCHRITT) {
      akkumulator -= SCHRITT;
      schritt();
    }
  } else if (phase === "bereit") {
    // Der wartende Vogel schwebt sanft auf und ab. Ohne diese Deko (bei
    // reduzierter Bewegung) bleibt er ruhig auf Starthöhe stehen.
    vogel.y = START_Y + (ruhigerModus ? 0 : Math.sin(jetzt / 280) * SCHWEBE_AMPLITUDE);
  } else if (phase === "vorbei" && !ruhigerModus) {
    // Der getroffene Vogel stürzt zu Boden (nur Optik, die Runde ist vorbei).
    vogelSchritt(vogel, abstandMs / 1000);
    vogel.y = Math.min(vogel.y, BODEN_Y - VOGEL_RADIUS_BILD);
  }

  partikelBewegen(abstandMs / 1000);

  // Nach dem Aufblitzen den Dialog zeigen (genau einmal).
  if (phase === "vorbei" && !dialogGezeigt && jetzt - blitzStart >= BLITZ_DAUER_MS) {
    dialogAnzeigen();
  }

  zeichneAlles(jetzt);
  requestAnimationFrame(einzelbild);
}

/* ============================================================
   Zeichnen
   ============================================================ */

/**
 * Parallax-Hintergrund: Zwei Reihen von Türmen (Skyline) wandern
 * unterschiedlich schnell, die hintere langsamer. So entsteht Tiefe. Jede
 * Reihe ist eine "Kachel" in Spielfeldbreite, die zweimal nebeneinander
 * gezeichnet wird, damit nichts abreißt. Die Bewegung ist reine Deko: Bei
 * bewegungReduziert() stehen die Ebenen still (sie werden trotzdem gezeichnet).
 */
const PARALLAX_HINTEN = 0.08;
const PARALLAX_VORNE = 0.22;

function baueSkyline(minB, maxB, minH, maxH) {
  const tuerme = [];
  for (let x = 0; x < BREITE; ) {
    const b = minB + Math.random() * (maxB - minB);
    tuerme.push({ x, b, h: minH + Math.random() * (maxH - minH) });
    x += b + Math.random() * 6;
  }
  return tuerme;
}
const skylineHinten = baueSkyline(26, 54, 60, 210);
const skylineVorne = baueSkyline(34, 70, 36, 120);

// Kleine Sterne am Himmel (feste Zufallspositionen)
const sterne = Array.from({ length: 28 }, () => ({
  x: Math.random() * BREITE,
  y: Math.random() * (BODEN_Y * 0.6),
  hell: 0.25 + Math.random() * 0.5,
}));

/** Mischt zwei #rrggbb-Farben (t = 0: a, t = 1: b). */
function farbMix(a, b, t) {
  const za = parseInt(a.slice(1), 16),
    zb = parseInt(b.slice(1), 16);
  const k = (s) => Math.round(((za >> s) & 255) * (1 - t) + ((zb >> s) & 255) * t);
  return `rgb(${k(16)},${k(8)},${k(0)})`;
}

function zeichneHimmel() {
  const z = zeichner;
  // In 1,5 s weich von der alten zur neuen Tageszeit überblenden
  const t = ruhigerModus ? 1 : Math.min(1, (flugzeit - himmelWechsel) / 1.5);
  const alt = HIMMEL[himmelVon],
    neu = HIMMEL[abschnitt];
  const verlauf = z.createLinearGradient(0, 0, 0, BODEN_Y);
  verlauf.addColorStop(0, farbMix(alt.oben, neu.oben, t));
  verlauf.addColorStop(1, farbMix(alt.unten, neu.unten, t));
  z.fillStyle = verlauf;
  z.fillRect(0, 0, BREITE, HOEHE);
  return alt.sterne + (neu.sterne - alt.sterne) * t;
}

function zeichneAlles(jetzt) {
  // --- Szene auf das halb so große Canvas ---
  zeichner = pixelZ;
  const z = zeichner;
  z.setTransform(PIXEL_RASTER, 0, 0, PIXEL_RASTER, 0, 0);
  z.globalAlpha = 1;
  z.shadowBlur = 0;
  const sternHelligkeit = zeichneHimmel();

  zeichneHintergrund(jetzt, sternHelligkeit);
  for (const paar of paare) zeichneSaeulenPaar(paar, jetzt);
  zeichneBoden();
  zeichnePartikel();
  zeichneVogel(jetzt);

  // --- ohne Glätten hochskalieren: Pixel-Look ---
  zeichner = hauptZ;
  hauptZ.setTransform(1, 0, 0, 1, 0, 0);
  hauptZ.imageSmoothingEnabled = false;
  hauptZ.drawImage(pixelLeinwand, 0, 0, BREITE, HOEHE);
  hauptZ.imageSmoothingEnabled = true;

  if (phase !== "bereit") zeichnePunkte();
  if (banner && flugzeit < bannerBis && phase === "laeuft") {
    hauptZ.save();
    hauptZ.textAlign = "center";
    hauptZ.textBaseline = "middle";
    hauptZ.font = `14px ${farben.schriftPixel}`;
    hauptZ.fillStyle = farben.text;
    hauptZ.shadowColor = "#000";
    hauptZ.shadowBlur = 6;
    hauptZ.fillText(banner, BREITE / 2, 96);
    hauptZ.restore();
  }

  if (phase === "bereit") {
    zeichneOverlay(
      ABSCHNITTE[abschnitt].name.toUpperCase(),
      text("Leertaste, Klick oder Tippen startet", "Tippen lässt den Vogel flattern"),
      jetzt,
    );
  } else if (phase === "pause") {
    zeichneOverlay("PAUSE", text("P oder Leertaste: weiter", "Antippen: weiter"), jetzt);
  } else if (phase === "vorbei" && !ruhigerModus) {
    zeichneBlitz(jetzt);
  }
}

function zeichneHintergrund(jetzt, sternHelligkeit = 1) {
  const z = zeichner;

  // Sterne (blinken nur ohne reduzierte Bewegung), tagsüber unsichtbar
  z.fillStyle = farben.text;
  for (const stern of sterne) {
    if (sternHelligkeit <= 0) break;
    z.globalAlpha =
      sternHelligkeit *
      stern.hell *
      (ruhigerModus ? 1 : 0.7 + 0.3 * Math.sin(jetzt / 600 + stern.x));
    z.fillRect(Math.round(stern.x), Math.round(stern.y), 2, 2);
  }
  z.globalAlpha = 1;

  const ebenen = [
    { tuerme: skylineHinten, faktor: PARALLAX_HINTEN, farbe: farben.flaeche },
    { tuerme: skylineVorne, faktor: PARALLAX_VORNE, farbe: farben.flaeche2 },
  ];
  for (const ebene of ebenen) {
    const versatz = ruhigerModus ? 0 : (strecke * ebene.faktor) % BREITE;
    z.fillStyle = ebene.farbe;
    for (const kachel of [0, 1]) {
      for (const turm of ebene.tuerme) {
        z.fillRect(
          Math.round(kachel * BREITE + turm.x - versatz),
          Math.round(BODEN_Y - turm.h),
          Math.ceil(turm.b),
          Math.ceil(turm.h),
        );
      }
    }
  }
}

function zeichneBoden() {
  const z = zeichner;
  z.fillStyle = farben.flaeche;
  z.fillRect(0, BODEN_Y, BREITE, HOEHE - BODEN_Y);

  z.save();
  z.fillStyle = farben.vogel;
  z.shadowColor = farben.vogel;
  z.shadowBlur = 8;
  z.globalAlpha = 0.85;
  z.fillRect(0, BODEN_Y, BREITE, 2);
  z.restore();

  // Schräge Striche laufen mit der vollen Weltgeschwindigkeit nach links. Das
  // ist Spielinformation (man sieht das Tempo), keine Deko, und läuft daher
  // auch bei reduzierter Bewegung.
  const abstand = 28;
  const versatz = strecke % abstand;
  z.strokeStyle = farben.linie;
  z.lineWidth = 3;
  z.beginPath();
  for (let x = -abstand; x < BREITE + abstand; x += abstand) {
    z.moveTo(x - versatz, BODEN_Y + 18);
    z.lineTo(x - versatz + 12, BODEN_Y + 6);
  }
  z.stroke();
}

/* ---------- Säulen ---------- */

/**
 * Zeichnet ein Säulenpaar. Wir benutzen dafür DIESELBEN vier Rechtecke wie
 * die Kollision (saeulenRechtecke). Was man sieht, ist also genau das, was
 * trifft: kein Rätselraten, welche Fläche gefährlich ist.
 */
function zeichneSaeulenPaar(paar, jetzt) {
  const rechtecke = saeulenRechtecke(paar);
  rechtecke.forEach((r, i) => {
    if (r.h <= 0) return;
    const istKappe = i === 1 || i === 2;
    if (istKappe) zeichneKappe(r);
    else zeichneKoerper(r, i === 0, jetzt);
  });
}

function zeichneKoerper(r, istOben, jetzt) {
  const z = zeichner;
  z.save();
  z.shadowColor = farben.saeule;
  z.shadowBlur = 10;
  z.fillStyle = farben.flaeche2;
  z.fillRect(r.x, r.y, r.b, r.h);
  z.shadowBlur = 0;

  // Energieleiste in der Mitte: kurze helle Impulse, die entlang der Säule
  // fließen. Ohne reduzierte Bewegung wandern sie, sonst stehen sie still.
  const pitch = 30;
  const fluss = ruhigerModus ? 0 : (jetzt / 18) % pitch;
  z.beginPath();
  z.rect(r.x, r.y, r.b, r.h);
  z.clip(); // nichts außerhalb der Säule malen
  z.fillStyle = farben.saeule;
  z.globalAlpha = 0.55;
  for (let y = r.y - pitch + (istOben ? fluss : pitch - fluss); y < r.y + r.h; y += pitch) {
    z.fillRect(r.x + r.b / 2 - 2, y, 4, 12);
  }
  z.globalAlpha = 0.25;
  z.fillRect(r.x + 5, r.y, 2, r.h); // Lichtkante links
  z.globalAlpha = 1;
  z.strokeStyle = farben.saeule;
  z.lineWidth = 2;
  z.strokeRect(r.x + 1, r.y - 2, r.b - 2, r.h + 4); // Neon-Rahmen
  z.restore();
}

function zeichneKappe(r) {
  const z = zeichner;
  z.save();
  z.shadowColor = farben.saeule;
  z.shadowBlur = 14;
  z.fillStyle = farben.saeule;
  z.fillRect(r.x, r.y, r.b, r.h);
  z.shadowBlur = 0;
  z.fillStyle = farben.saeuleHell;
  z.globalAlpha = 0.7;
  z.fillRect(r.x + 4, r.y + 4, r.b - 8, 4); // Glanzstreifen
  z.restore();
}

/* ---------- Vogel ---------- */

function zeichneVogel(jetzt) {
  const z = zeichner;
  const winkel = phase === "vorbei" ? 1.1 : neigung(vogel.vy);

  // Flügel-Phase 0..1: Beim Warten schlägt er im Dauertakt, sonst genau
  // einmal pro Flügelschlag (danach Ruhestellung = Spitze oben).
  const t =
    phase === "bereit" ? ((jetzt / 1000) % 0.5) / 0.5 : Math.min(schlagZeit / SCHLAG_DAUER, 1);
  // cos(2π·t): 0 → Spitze oben, 0,5 → ganz unten, 1 → wieder oben.
  const fluegelSpitzeY = -13 * Math.cos(t * Math.PI * 2);

  z.save();
  z.translate(VOGEL_X, vogel.y); // Nullpunkt in die Vogelmitte legen ...
  z.rotate(winkel); // ... dann um diesen Punkt drehen. Reihenfolge ist wichtig!

  z.shadowColor = farben.vogel;
  z.shadowBlur = 14;

  // Schwanz: kleines Dreieck hinten
  z.fillStyle = farben.vogel;
  z.beginPath();
  z.moveTo(-13, -2);
  z.lineTo(-27, -9);
  z.lineTo(-25, 5);
  z.closePath();
  z.fill();

  // Körper: Kreis
  z.beginPath();
  z.arc(0, 0, VOGEL_RADIUS_BILD, 0, Math.PI * 2);
  z.fill();

  z.shadowBlur = 0;
  // Bauch: hellerer Kreis, leicht versetzt (gibt Rundung)
  z.fillStyle = farben.vogelHell;
  z.globalAlpha = 0.5;
  z.beginPath();
  z.arc(-2, 6, 9, 0, Math.PI * 2);
  z.fill();
  z.globalAlpha = 1;

  // Schnabel: Dreieck
  z.fillStyle = farben.schnabel;
  z.beginPath();
  z.moveTo(14, -3);
  z.lineTo(28, 3);
  z.lineTo(14, 9);
  z.closePath();
  z.fill();

  // Auge
  z.fillStyle = farben.text;
  z.beginPath();
  z.arc(7, -6, 5, 0, Math.PI * 2);
  z.fill();
  z.fillStyle = farben.hintergrund;
  z.beginPath();
  z.arc(8.5, -6, 2.3, 0, Math.PI * 2);
  z.fill();

  // Flügel: Dreieck, Basis am Körper, Spitze schwingt hoch und runter
  z.fillStyle = farben.saeule;
  z.shadowColor = farben.saeule;
  z.shadowBlur = 8;
  z.beginPath();
  z.moveTo(2, -6); // Basis oben (am Körper)
  z.lineTo(2, 6); // Basis unten
  z.lineTo(-21, fluegelSpitzeY); // bewegliche Spitze
  z.closePath();
  z.fill();

  z.restore();
}

/* ---------- Partikel (Federn und Funken, nur Deko) ---------- */

function federnErzeugen() {
  if (ruhigerModus) return; // reine Deko → bei reduzierter Bewegung weglassen
  for (let i = 0; i < 5; i++) {
    partikel.push({
      x: VOGEL_X - 14 + Math.random() * 6,
      y: vogel.y + 4 + Math.random() * 8,
      vx: -50 - Math.random() * 60,
      vy: 20 + Math.random() * 60,
      leben: 1,
      farbe: i % 2 === 0 ? farben.vogelHell : farben.saeule,
    });
  }
}

function funkenErzeugen() {
  if (ruhigerModus) return;
  for (let i = 0; i < 18; i++) {
    const winkel = Math.random() * Math.PI * 2;
    const tempo = 60 + Math.random() * 180;
    partikel.push({
      x: VOGEL_X,
      y: vogel.y,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo - 40,
      leben: 1,
      farbe: i % 3 === 0 ? farben.schnabel : farben.vogel,
    });
  }
}

/** `sekunden` ist die echte Zeit seit dem letzten Frame → gleich schnell auf jedem Gerät. */
function partikelBewegen(sekunden) {
  for (const p of partikel) {
    p.x += p.vx * sekunden;
    p.y += p.vy * sekunden;
    p.vy += 300 * sekunden; // sie sinken leicht
    p.leben -= sekunden * 2.2; // in ca. 0,45 s ausgeblendet
  }
  partikel = partikel.filter((p) => p.leben > 0);
}

function zeichnePartikel() {
  const z = zeichner;
  z.save();
  for (const p of partikel) {
    z.globalAlpha = Math.max(p.leben, 0);
    z.fillStyle = p.farbe;
    const kante = 1 + 3 * p.leben;
    z.fillRect(Math.round(p.x), Math.round(p.y), kante, kante);
  }
  z.restore();
}

/* ---------- Anzeigen auf dem Spielfeld ---------- */

/** Großer Punktestand oben in der Mitte (zusätzlich zum HUD, damit der Blick im Spiel bleibt). */
function zeichnePunkte() {
  const z = zeichner;
  z.save();
  z.textAlign = "center";
  z.textBaseline = "middle";
  z.font = `30px ${farben.schriftPixel}`;
  z.shadowColor = farben.vogel;
  z.shadowBlur = 12;
  z.fillStyle = farben.text;
  z.globalAlpha = 0.9;
  z.fillText(String(punkte), BREITE / 2, 52);
  z.restore();
}

/** Abgedunkelte Fläche mit zwei Textzeilen (Start- und Pause-Anzeige). */
function zeichneOverlay(titel, untertitel, jetzt) {
  const z = zeichner;
  z.save();
  z.globalAlpha = 0.55;
  z.fillStyle = farben.hintergrund;
  z.fillRect(0, 0, BREITE, HOEHE);

  z.globalAlpha = 1;
  z.textAlign = "center";
  z.textBaseline = "middle";

  // Der Text sitzt im unteren Drittel, damit der wartende Vogel frei bleibt.
  z.shadowColor = farben.vogel;
  z.shadowBlur = 14;
  z.fillStyle = farben.text;
  z.font = `20px ${farben.schriftPixel}`;
  z.fillText(titel, BREITE / 2, 372);

  // Die zweite Zeile "atmet" leicht, damit klar ist: Hier wird auf dich gewartet.
  z.shadowBlur = 0;
  z.globalAlpha = ruhigerModus ? 1 : 0.7 + 0.3 * Math.sin(jetzt / 350);
  z.fillStyle = farben.text;
  z.font = `16px ${farben.schriftText}`;
  z.fillText(untertitel, BREITE / 2, 408);
  z.restore();
}

/**
 * Weißes Aufblitzen nach dem Treffer: dreimal an- und abschwellend.
 * |sin| ist immer positiv und "pocht" dreimal, wenn t von 0 bis 1 läuft.
 * Der Faktor (1 - t) lässt das Aufblitzen gleichzeitig ausklingen.
 */
function zeichneBlitz(jetzt) {
  const t = (jetzt - blitzStart) / BLITZ_DAUER_MS;
  if (t >= 1) return;
  // EIN weicher Puls statt drei: mehr als 3 Blitze pro Sekunde können
  // bei Fotosensibilität Anfälle auslösen (WCAG 2.3.1).
  const staerke = Math.sin(t * Math.PI) * 0.6;
  zeichner.save();
  zeichner.globalAlpha = staerke;
  zeichner.fillStyle = farben.text;
  zeichner.fillRect(0, 0, BREITE, HOEHE);
  zeichner.restore();
}

/* ============================================================
   Start
   ============================================================ */
const wahl = levelWahl({
  spiel: SPIEL,
  titel: "Abschnitt wählen",
  namen: ABSCHNITTE.map((a) => a.name),
  nach: document.querySelector(".steuerung"),
  gesperrt: () => phase === "laeuft",
  beiWahl: (n) => neuesSpiel(n - 1),
});
neuesSpiel(0);
// Handy: große Flatter-Taste, Einpassen, Scroll-Sperre, Spielmodus (assets/mobil.js)
spielSeite({
  phase: () => phase,
  gamepad: {
    rechts: [
      { ...TASTE.leer, zeichen: "▲", name: "Flattern", beschriftung: "FLATTERN", gross: true },
    ],
  },
});
letzteZeit = performance.now();
requestAnimationFrame(einzelbild);
