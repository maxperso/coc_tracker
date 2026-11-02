/**
 * Horloge de travail d'un groupe de chantiers (ouvriers, labo ou animaux).
 * Pendant une potion, chaque heure réelle vaut `1 + extraHours` heures de travail.
 * Les fenêtres de potion sont exprimées en heures depuis l'export et ne se chevauchent pas.
 */
export class WorkClock {
  private readonly windows: { start: number; end: number }[];

  constructor(potionStarts: number[], readonly extraHours: number, readonly potionLength = 1) {
    const sorted = [...potionStarts].sort((a, b) => a - b);
    this.windows = [];
    for (const s of sorted) {
      const last = this.windows[this.windows.length - 1];
      // Deux potions prises à la suite s'enchaînent au lieu de se chevaucher.
      const start = last && s < last.end ? last.end : s;
      this.windows.push({ start, end: start + potionLength });
    }
  }

  get potionWindows(): readonly { start: number; end: number }[] {
    return this.windows;
  }

  /** Heures de travail accumulées entre l'export (t = 0) et t. */
  work(t: number): number {
    let w = t;
    for (const win of this.windows) {
      if (win.start >= t) break;
      w += this.extraHours * (Math.min(t, win.end) - win.start);
    }
    return w;
  }

  /** Instant réel où le travail cumulé atteint `w` (inverse de `work`). */
  timeAt(w: number): number {
    let t = 0;
    let acc = 0;
    for (const win of this.windows) {
      // Segment sans potion avant la fenêtre.
      if (acc + (win.start - t) >= w) return t + (w - acc);
      acc += win.start - t;
      t = win.start;
      const gain = (1 + this.extraHours) * (win.end - win.start);
      if (acc + gain >= w) return t + (w - acc) / (1 + this.extraHours);
      acc += gain;
      t = win.end;
    }
    return t + (w - acc);
  }

  /** Fin réelle d'un chantier lancé à `start` et demandant `hours` heures de travail. */
  endOf(start: number, hours: number): number {
    return this.timeAt(this.work(start) + hours);
  }
}
