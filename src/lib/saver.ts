/**
 * Enregistrement fiable d'un état sur le serveur (coches du plan, réglages).
 * - Un seul envoi à la fois, et c'est toujours le dernier état qui part : pas d'écrasement dans le désordre.
 * - Un envoi raté est gardé et retenté au prochain changement ou par `retry()` (retour dans l'app, réseau revenu).
 * - `flush()` part tout de suite, en « keepalive » : le navigateur termine l'envoi même si l'app passe en
 *   arrière-plan ou se ferme (sur téléphone, on coche puis on repart aussitôt dans le jeu).
 */
export interface Saver<T> {
  /** Nouvel état à enregistrer : envoyé tout de suite, ou après `delayMs`. */
  save(value: T): void;
  /** Envoie maintenant ce qui attend (sortie de l'app). */
  flush(): void;
  /** Renvoie un état dont l'envoi a échoué. */
  retry(): void;
  /** Un état n'est pas encore confirmé par le serveur. */
  readonly dirty: boolean;
}

export function createSaver<T>(opts: {
  send: (value: T, keepalive: boolean) => Promise<unknown>;
  onError: (e: unknown) => void;
  /** Regroupe les changements rapprochés (saisie au clavier) ; 0 = envoi immédiat. */
  delayMs?: number;
}): Saver<T> {
  let pending: { value: T } | null = null;
  let inFlight = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function pump(keepalive = false) {
    if (inFlight || !pending) return;
    const { value } = pending;
    pending = null;
    inFlight = true;
    try {
      await opts.send(value, keepalive);
      failed = false;
    } catch (e) {
      // Un état plus récent a pu arriver pendant l'envoi : c'est lui qu'on gardera.
      pending ??= { value };
      failed = true;
      opts.onError(e);
    } finally {
      inFlight = false;
    }
    if (pending && !failed) void pump();
  }

  return {
    save(value) {
      pending = { value };
      failed = false;
      clearTimeout(timer);
      if (opts.delayMs) timer = setTimeout(() => void pump(), opts.delayMs);
      else void pump();
    },
    flush() {
      clearTimeout(timer);
      void pump(true);
    },
    retry() {
      if (!failed) return;
      failed = false;
      void pump();
    },
    get dirty() {
      return pending != null || inFlight;
    },
  };
}
