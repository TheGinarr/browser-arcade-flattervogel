/* ============================================================
   FLATTERVOGEL · logik.js
   ------------------------------------------------------------
   Alles in dieser Datei ist "pure Logik": Funktionen, die nur
   rechnen und weder auf das Canvas noch auf die Seite (document)
   zugreifen. So lässt sich die Spielregel-Mathematik ohne Browser
   testen (z. B. mit node), und game.js bleibt übersichtlich: Dort
   stehen nur Eingabe, Schleife und Zeichnen.

   KOORDINATEN: Das Canvas ist 360 x 540 Pixel groß. (0|0) ist
   OBEN links, y wächst nach UNTEN. Positive Geschwindigkeit `vy`
   heißt deshalb: der Vogel fällt. Ein Flügelschlag setzt `vy` auf
   einen negativen Wert (= nach oben).
   ============================================================ */

/* ---------- Spielfeld ---------- */
export const BREITE = 360;
export const HOEHE = 540;
export const BODEN_Y = 480;            // ab hier beginnt der Boden (60 px Streifen darunter)
export const DECKE_Y = 0;              // oberer Rand des Spielfelds
export const VOGEL_X = 100;            // der Vogel bleibt links stehen, die Säulen wandern an ihm vorbei
export const START_Y = 240;            // Starthöhe des Vogels

/* ---------- Vogel ---------- */
export const VOGEL_RADIUS_BILD = 17;   // so groß wird er gezeichnet
export const VOGEL_RADIUS_HIT = 13;    // so groß ist seine Hitbox (kleiner = fairer)
export const GRAVITATION = 1500;       // px/s² nach unten
export const FLUEGELSCHLAG_V = -450;   // Geschwindigkeit direkt nach dem Schlag (negativ = nach oben)
export const MAX_FALLTEMPO = 620;      // schneller als das fällt er nie (wie ein Luftwiderstand)

/* ---------- Säulen ---------- */
export const SAEULE_B = 62;            // Breite des Säulenkörpers
export const KAPPE_H = 22;             // Höhe der breiteren "Kappe" am Lückenrand
export const KAPPE_UEBERSTAND = 5;     // so viel ragt die Kappe links/rechts über den Körper
export const LUECKE_MIN = 150;         // Lückenhöhe zufällig zwischen MIN und MAX
export const LUECKE_MAX = 180;
export const ABSTAND_ZEIT_MIN = 1.3;   // Sekunden zwischen zwei Säulenpaaren (linke Kante zu linker Kante) ...
export const ABSTAND_ZEIT_MAX = 1.6;   // ... zufällig zwischen MIN und MAX
export const RAND_OBEN = 60;           // Lücke hält mindestens so viel Abstand zur Decke ...
export const RAND_UNTEN = 60;          // ... und zum Boden
export const MAX_MITTEN_SPRUNG = 150;  // Lückenmitte weicht höchstens so weit vom Vorgänger ab

/* ---------- Tempo ---------- */
export const START_TEMPO = 150;        // px/s, mit denen die Säulen nach links wandern
export const TEMPO_PRO_PUNKT = 2;      // pro passierter Säule etwas schneller
export const MAX_TEMPO = 210;

/** Tempo der Säulen in Pixel pro Sekunde, abhängig vom Punktestand. */
export function tempoFuerPunkte(punkte) {
  return Math.min(MAX_TEMPO, START_TEMPO + TEMPO_PRO_PUNKT * punkte);
}

/** Hält `wert` zwischen `min` und `max` fest (ein häufiger Baustein, auch im Kollisionscode). */
export function begrenzen(wert, min, max) {
  return Math.max(min, Math.min(max, wert));
}

/* ============================================================
   Vogel-Physik
   ============================================================ */

export function neuerVogel() {
  return { y: START_Y, vy: 0 };
}

/** Flügelschlag: Der Vogel bekommt einen Schub nach oben. Er ÜBERSCHREIBT die Fallgeschwindigkeit, statt sie nur zu verringern. So fühlt sich jeder Schlag gleich an. */
export function fluegelschlag(vogel) {
  vogel.vy = FLUEGELSCHLAG_V;
}

/**
 * Ein Physikschritt von `dt` Sekunden: Die Gravitation erhöht die
 * Fallgeschwindigkeit, die Geschwindigkeit verschiebt die Position.
 */
export function vogelSchritt(vogel, dt) {
  vogel.vy = Math.min(MAX_FALLTEMPO, vogel.vy + GRAVITATION * dt);
  vogel.y += vogel.vy * dt;
}

/**
 * Neigung des Vogels in Radiant (für ctx.rotate): Steigt er, zeigt die
 * Schnabelspitze etwas nach oben, fällt er, kippt er nach unten.
 * Der Wertebereich wird begrenzt, damit er nie ganz auf dem Kopf steht.
 */
export function neigung(vy) {
  return begrenzen(vy * 0.002, -0.5, 1.1);
}

/* ============================================================
   Kollision: Kreis gegen Rechteck
   ============================================================ */

/**
 * Trifft ein Kreis (Mittelpunkt kx|ky, Radius r) ein Rechteck {x, y, b, h}?
 *
 * DER LERNKERN: Statt Ecken und Kanten einzeln zu prüfen, suchen wir den
 * Punkt des Rechtecks, der dem Kreismittelpunkt am NÄCHSTEN liegt:
 *   - Liegt der Mittelpunkt links vom Rechteck, ist das nächste x die
 *     linke Kante. Liegt er rechts davon, die rechte Kante. Liegt er
 *     dazwischen, ist es sein eigenes x. Das ist genau "begrenzen" auf
 *     den Bereich [x, x + b]. Für y gilt dasselbe.
 *   - Der Abstand vom Mittelpunkt zu diesem nächsten Punkt entscheidet:
 *     Ist er kleiner als der Radius, berührt der Kreis das Rechteck.
 * Drei Fälle fallen dabei automatisch richtig ab:
 *   Mittelpunkt IM Rechteck -> nächster Punkt = Mittelpunkt, Abstand 0 -> Treffer.
 *   Neben einer KANTE       -> Abstand = Entfernung zur Kante.
 *   Neben einer ECKE        -> Abstand ist die DIAGONALE zur Ecke (Pythagoras).
 * Der Eck-Fall ist der Unterschied zu zwei überlappenden Kästchen: Ein
 * Kreis kann mit seiner Bounding-Box schon in die Ecke ragen, ohne sie zu
 * berühren, weil die Ecke des Kreises "abgerundet" ist.
 *
 * Wir vergleichen Abstand² mit Radius². Das spart die Wurzel (sqrt) und
 * liefert dasselbe Ergebnis, weil beide Seiten positiv sind.
 * Mit "<" (strikt) zählt eine bloße Berührung nicht als Treffer.
 */
export function kreisTrifftRechteck(kx, ky, r, rechteck) {
  const naechstesX = begrenzen(kx, rechteck.x, rechteck.x + rechteck.b);
  const naechstesY = begrenzen(ky, rechteck.y, rechteck.y + rechteck.h);
  const dx = kx - naechstesX;
  const dy = ky - naechstesY;
  return dx * dx + dy * dy < r * r;
}

/**
 * Die vier Rechtecke eines Säulenpaars: oberer Körper, obere Kappe,
 * untere Kappe, unterer Körper. Die Kappen sind etwas breiter und liegen
 * am Lückenrand. Die Lücke selbst ist frei.
 * Ein Paar ist {x, mitteY, luecke, gewertet}: x = linke Kante des Körpers.
 */
export function saeulenRechtecke(paar) {
  const oben = paar.mitteY - paar.luecke / 2;      // untere Kante der oberen Säule
  const unten = paar.mitteY + paar.luecke / 2;     // obere Kante der unteren Säule
  const kappeX = paar.x - KAPPE_UEBERSTAND;
  const kappeB = SAEULE_B + 2 * KAPPE_UEBERSTAND;
  return [
    { x: paar.x, y: DECKE_Y, b: SAEULE_B, h: Math.max(0, oben - KAPPE_H - DECKE_Y) },
    { x: kappeX, y: oben - KAPPE_H, b: kappeB, h: KAPPE_H },
    { x: kappeX, y: unten, b: kappeB, h: KAPPE_H },
    { x: paar.x, y: unten + KAPPE_H, b: SAEULE_B, h: Math.max(0, BODEN_Y - (unten + KAPPE_H)) },
  ];
}

/**
 * Woran stirbt der Vogel gerade? Gibt "saeule", "boden", "decke" oder
 * null (alles gut) zurück. Boden und Decke sind einfache Zahlenvergleiche,
 * nur die Säulen brauchen die Kreis-Rechteck-Prüfung.
 */
export function kollisionsGrund(vogel, paare) {
  const r = VOGEL_RADIUS_HIT;
  if (vogel.y + r >= BODEN_Y) return "boden";
  if (vogel.y - r <= DECKE_Y) return "decke";
  for (const paar of paare) {
    // Schnelltest: Paare weit weg vom Vogel überspringen (spart Rechnerei).
    if (paar.x - KAPPE_UEBERSTAND - r > VOGEL_X || paar.x + SAEULE_B + KAPPE_UEBERSTAND + r < VOGEL_X) continue;
    if (saeulenRechtecke(paar).some((rechteck) => kreisTrifftRechteck(VOGEL_X, vogel.y, r, rechteck))) return "saeule";
  }
  return null;
}

/** Hat der Vogel die Mitte des Säulenpaars hinter sich gelassen? Dann gibt es den Punkt. */
export function paarPassiert(paar, vogelX = VOGEL_X) {
  return paar.x + SAEULE_B / 2 < vogelX;
}

/* ============================================================
   Säulenpaare erzeugen
   ============================================================ */

/**
 * Baut ein neues Säulenpaar an der Stelle x.
 * `vorherigeMitte` ist die Lückenmitte des letzten Paars (oder null beim
 * ersten). `zufallsquelle` liefert bei jedem Aufruf eine Zahl in [0, 1)
 * (im Spiel Math.random, im Test ein festes Skript).
 *
 * WARUM NICHT EINFACH ZUFÄLLIG? Läge die nächste Lücke ganz oben und die
 * folgende ganz unten, müsste der Vogel in rund einer Sekunde 300 Pixel
 * steigen. Das schafft keiner. Darum darf die Lückenmitte nur
 * MAX_MITTEN_SPRUNG Pixel von der vorherigen abweichen und wird auf den
 * erlaubten Bereich begrenzt (Abstand zu Decke und Boden).
 */
export function neuesPaar(x, vorherigeMitte, zufallsquelle, abschnitt = ABSCHNITTE[0]) {
  const [lueckeMin, lueckeMax] = abschnitt.luecke;
  const luecke = lueckeMin + zufallsquelle() * (lueckeMax - lueckeMin);
  // Bewegliche Säulen schwingen um ihre Mitte: Damit die Lücke nie in
  // Decke oder Boden rutscht, wird der erlaubte Bereich um die
  // Schwingweite (amplitude) kleiner.
  const amplitude = abschnitt.bewegung;
  const minMitte = DECKE_Y + RAND_OBEN + luecke / 2 + amplitude;
  const maxMitte = BODEN_Y - RAND_UNTEN - luecke / 2 - amplitude;
  const wurf = zufallsquelle();
  const basisMitte = vorherigeMitte === null
    ? minMitte + wurf * (maxMitte - minMitte)                                   // erstes Paar: irgendwo
    : begrenzen(vorherigeMitte + (wurf * 2 - 1) * MAX_MITTEN_SPRUNG, minMitte, maxMitte);
  return { x, mitteY: basisMitte, basisMitte, amplitude, phase: zufallsquelle() * Math.PI * 2, luecke, gewertet: false };
}

/* ---------- Abschnitte ----------
   Alle 10 Säulen beginnt ein neuer Abschnitt: engere Lücken, ab
   Abschnitt 3 schwingen die Säulen auf und ab, dazu wechselt die
   Tageszeit. Nach dem letzten bleibt es dort. */
export const ABSCHNITTE = [
  { name: "Morgengrauen", ab: 0,  luecke: [150, 180], bewegung: 0 },
  { name: "Mittag",       ab: 10, luecke: [146, 172], bewegung: 0 },
  { name: "Böen",         ab: 20, luecke: [144, 168], bewegung: 24 },
  { name: "Abendrot",     ab: 30, luecke: [140, 162], bewegung: 34 },
  { name: "Mitternacht",  ab: 40, luecke: [136, 158], bewegung: 42 },
];
export const SCHWING_DAUER = 2.4;      // Sekunden für ein komplettes Auf und Ab

/** Abschnitt für den Punktestand (nie unter dem gewählten Start-Abschnitt). */
export function abschnittIndex(punkte, start = 0) {
  let index = 0;
  ABSCHNITTE.forEach((a, i) => { if (punkte >= a.ab) index = i; });
  return Math.max(index, start);
}

/** Aktuelle Lückenmitte eines (evtl. schwingenden) Paars zur Zeit t in Sekunden. */
export function schwingMitte(paar, t) {
  if (!paar.amplitude) return paar.basisMitte;
  return paar.basisMitte + Math.sin((t / SCHWING_DAUER) * Math.PI * 2 + paar.phase) * paar.amplitude;
}

/**
 * Abstand (linke Kante zu linker Kante) bis zum nächsten Paar in Pixeln.
 *
 * WARUM IN ZEIT GERECHNET? Der Vogel kann pro Sekunde nur begrenzt sinken
 * (Gravitation!). Zwischen zwei Paaren hat er eine bestimmte ZEIT, um auf
 * die nächste Lückenhöhe zu kommen. Läge der Abstand fest in Pixeln,
 * würde diese Zeit mit steigendem Tempo schrumpfen, und große Abstiege
 * wären irgendwann nicht mehr zu schaffen. Darum legen wir die Zeit fest
 * und rechnen sie mit  Strecke = Tempo * Zeit  in Pixel um.
 * `zufall` ist eine Zahl in [0, 1).
 */
export function naechsterPaarAbstand(tempo, zufall) {
  return tempo * (ABSTAND_ZEIT_MIN + zufall * (ABSTAND_ZEIT_MAX - ABSTAND_ZEIT_MIN));
}
