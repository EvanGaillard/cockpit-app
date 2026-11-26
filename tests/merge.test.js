// Tests de la fusion (merge.js), sans navigateur : node Systeme/Cockpit/app/tests/merge.test.js
"use strict";
const assert = require("assert");
const M = require("../merge.js");

let ok = 0;
function t(name, fn) { try { fn(); ok++; console.log("ok  ·", name); } catch (e) { console.error("ÉCHEC ·", name, "\n", e.message); process.exitCode = 1; } }

const base = { items: [
  { id: "a", title: "Tâche A", done: false, prio: "haute" },
  { id: "b", title: "Tâche B", done: false, prio: "moyenne", tags: ["école"] },
  { id: "c", title: "Tâche C", done: false, prio: "basse" },
] };
const cl = (v) => JSON.parse(JSON.stringify(v));

t("un seul côté a changé : on le garde", () => {
  const local = cl(base); local.items[0].done = true;
  assert.deepStrictEqual(M.merge3(base, local, cl(base)), local);
  assert.deepStrictEqual(M.merge3(base, cl(base), local), local);
});

t("ajouts des deux côtés : aucune tâche perdue", () => {
  const local = cl(base); local.items.push({ id: "l1", title: "Ajout appareil" });
  const remote = cl(base); remote.items.push({ id: "r1", title: "Ajout Léon", byClaude: true });
  const m = M.merge3(base, local, remote);
  assert.deepStrictEqual(m.items.map((x) => x.id), ["a", "b", "c", "r1", "l1"]);
});

t("champs différents du même élément : les deux changements gardés", () => {
  const local = cl(base); local.items[1].done = true; local.items[1].doneAt = "2026-11-26";
  const remote = cl(base); remote.items[1].title = "Tâche B (renommée)";
  const m = M.merge3(base, local, remote);
  assert.strictEqual(m.items[1].done, true);
  assert.strictEqual(m.items[1].doneAt, "2026-11-26");
  assert.strictEqual(m.items[1].title, "Tâche B (renommée)");
});

t("même champ modifié des deux côtés : le plus récent gagne (preferLocal)", () => {
  const local = cl(base); local.items[2].prio = "haute";
  const remote = cl(base); remote.items[2].prio = "moyenne";
  assert.strictEqual(M.merge3(base, local, remote, { preferLocal: true }).items[2].prio, "haute");
  assert.strictEqual(M.merge3(base, local, remote, { preferLocal: false }).items[2].prio, "moyenne");
});

t("tickets : `maj` le plus récent gagne, journal fusionné", () => {
  const b = { tickets: [{ id: "t1", n: 1, statut: "attente", maj: "2026-11-26T10:00:00Z", journal: [{ at: "2026-11-26T10:00:00Z", qui: "Léon", txt: "Question" }] }] };
  const local = cl(b); local.tickets[0].statut = "en_cours"; local.tickets[0].reponse = "Oui"; local.tickets[0].maj = "2026-11-26T12:00:00Z"; local.tickets[0].journal.push({ at: "2026-11-26T12:00:00Z", qui: "Evan", txt: "Réponse : Oui" });
  const remote = cl(b); remote.tickets[0].statut = "fait"; remote.tickets[0].maj = "2026-11-26T11:00:00Z"; remote.tickets[0].journal.push({ at: "2026-11-26T11:00:00Z", qui: "Léon", txt: "Livré" });
  const m = M.merge3(b, local, remote, { preferLocal: false });
  assert.strictEqual(m.tickets[0].statut, "en_cours"); // maj local plus récent
  assert.strictEqual(m.tickets[0].reponse, "Oui");
  assert.strictEqual(m.tickets[0].journal.length, 3);
});

t("suppression d'un côté, modification de l'autre : l'élément est gardé", () => {
  const local = cl(base); local.items = local.items.filter((x) => x.id !== "a");
  const remote = cl(base); remote.items[0].title = "A modifiée par Léon";
  const m = M.merge3(base, local, remote);
  assert.ok(m.items.some((x) => x.id === "a" && x.title === "A modifiée par Léon"));
});

t("suppression d'un côté sans modification de l'autre : supprimé", () => {
  const local = cl(base); local.items = local.items.filter((x) => x.id !== "c");
  const remote = cl(base); remote.items.push({ id: "r2", title: "autre" });
  const m = M.merge3(base, local, remote);
  assert.ok(!m.items.some((x) => x.id === "c"));
  assert.ok(m.items.some((x) => x.id === "r2"));
});

t("habitudes cochées (tableaux simples) : fusion comme un ensemble", () => {
  const b = { items: [], log: { "2026-11-26": ["h1"] } };
  const local = cl(b); local.log["2026-11-26"].push("h2");
  const remote = cl(b); remote.log["2026-11-26"] = []; remote.log["2026-11-25"] = ["h3"];
  const m = M.merge3(b, local, remote);
  assert.deepStrictEqual(m.log["2026-11-26"], ["h2"]);
  assert.deepStrictEqual(m.log["2026-11-25"], ["h3"]);
});

t("première synchro (pas de base) : rien de perdu", () => {
  const local = { items: [{ id: "x", title: "créée hors ligne avant le jeton" }] };
  const m = M.merge3(undefined, local, cl(base));
  assert.strictEqual(m.items.length, 4);
});

t("equipe : numéro de ticket en double renuméroté", () => {
  const b = { tickets: [{ id: "t1", n: 1 }] };
  const local = { tickets: [{ id: "t1", n: 1 }, { id: "app1", n: 2, source: "app" }] };
  const remote = { tickets: [{ id: "t1", n: 1 }, { id: "leon", n: 2, source: "bureau" }] };
  const m = M.mergeDoc("equipe", b, local, remote, {});
  const byId = Object.fromEntries(m.tickets.map((x) => [x.id, x.n]));
  assert.strictEqual(byId.leon, 2); assert.strictEqual(byId.app1, 3);
});

t("format d'écriture identique aux fichiers du dépôt (clés triées, indentation 1)", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "..", "data");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    assert.strictEqual(M.stableStringify(JSON.parse(txt)), txt.replace(/\n$/, ""), f);
  }
});

console.log(ok + " tests de fusion réussis" + (process.exitCode ? " (avec des échecs)" : ""));
