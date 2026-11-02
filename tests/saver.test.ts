import { describe, expect, it, vi } from "vitest";
import { createSaver } from "../src/lib/saver";

/** Faux serveur : chaque envoi attend qu'on le termine à la main. */
function fakeServer() {
  const calls: { value: number; keepalive: boolean; ok: () => void; fail: () => void }[] = [];
  const send = (value: number, keepalive: boolean) =>
    new Promise<void>((ok, ko) => calls.push({ value, keepalive, ok: () => ok(), fail: () => ko(new Error("réseau")) }));
  return { calls, send };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("enregistrement fiable", () => {
  it("envoie tout de suite, un seul envoi à la fois, et le dernier état gagne", async () => {
    const s = fakeServer();
    const saver = createSaver({ send: s.send, onError: () => {} });
    saver.save(1);
    saver.save(2);
    saver.save(3);
    expect(s.calls.map((c) => c.value)).toEqual([1]);
    s.calls[0].ok();
    await tick();
    expect(s.calls.map((c) => c.value)).toEqual([1, 3]);
    expect(saver.dirty).toBe(true);
    s.calls[1].ok();
    await tick();
    expect(saver.dirty).toBe(false);
  });

  it("garde un envoi raté et le renvoie", async () => {
    const s = fakeServer();
    const onError = vi.fn();
    const saver = createSaver({ send: s.send, onError });
    saver.save(1);
    s.calls[0].fail();
    await tick();
    expect(onError).toHaveBeenCalledOnce();
    expect(saver.dirty).toBe(true);
    expect(s.calls).toHaveLength(1);
    saver.retry();
    expect(s.calls.map((c) => c.value)).toEqual([1, 1]);
    s.calls[1].ok();
    await tick();
    expect(saver.dirty).toBe(false);
  });

  it("un état plus récent remplace celui qui a échoué", async () => {
    const s = fakeServer();
    const saver = createSaver({ send: s.send, onError: () => {} });
    saver.save(1);
    saver.save(2);
    s.calls[0].fail();
    await tick();
    saver.retry();
    expect(s.calls.map((c) => c.value)).toEqual([1, 2]);
  });

  it("regroupe la saisie rapide, mais part tout de suite à la sortie de l'app", async () => {
    vi.useFakeTimers();
    const s = fakeServer();
    const saver = createSaver({ send: s.send, onError: () => {}, delayMs: 600 });
    saver.save(1);
    saver.save(2);
    expect(s.calls).toHaveLength(0);
    saver.flush();
    expect(s.calls).toEqual([expect.objectContaining({ value: 2, keepalive: true })]);
    vi.advanceTimersByTime(1000);
    expect(s.calls).toHaveLength(1);
    vi.useRealTimers();
  });
});
