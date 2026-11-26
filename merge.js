/* Cockpit app · fusion des documents (sans dépendance, utilisable dans le navigateur et dans Node).
 *
 * merge3(base, local, remote, opts) : fusion à trois voies.
 *  - base   : la version du dépôt sur laquelle l'appareil s'est appuyé (dernière synchro) ;
 *  - local  : la version de l'appareil (avec les changements pas encore envoyés) ;
 *  - remote : la version actuelle du dépôt (écrite par une autre machine ou une routine de Léon).
 * Règles :
 *  - ce qui n'a changé que d'un côté est gardé ;
 *  - un tableau d'objets avec `id` (tâches, projets, étapes, tickets…) est fusionné élément par élément :
 *    un élément ajouté d'un côté est toujours gardé ; un élément supprimé d'un côté et modifié de l'autre est gardé ;
 *  - un autre tableau (tags, plan du jour, habitudes cochées, journal d'un ticket…) est fusionné comme un ensemble :
 *    ajouts des deux côtés, suppressions des deux côtés ;
 *  - si un même champ a changé des deux côtés, le plus récent gagne : `maj` de l'élément quand les deux en ont un,
 *    sinon opts.preferLocal (calculé par l'app : modification locale plus récente que le dernier commit distant).
 */
(function (root) {
  "use strict";
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const hasId = (v) => isObj(v) && (typeof v.id === "string" || typeof v.id === "number");
  const MISSING = undefined;

  function stableStringify(v, indent) {
    return JSON.stringify(sortKeys(v), null, indent == null ? 1 : indent);
  }
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (isObj(v)) { const o = {}; Object.keys(v).sort().forEach((k) => { if (v[k] !== undefined) o[k] = sortKeys(v[k]); }); return o; }
    return v;
  }
  function equal(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function idArrays(...arrs) {
    // un tableau « par id » : tous ses éléments (des trois versions) sont des objets avec id, et au moins un existe
    let n = 0;
    for (const a of arrs) { if (a === MISSING) continue; if (!Array.isArray(a)) return false; for (const x of a) { if (!hasId(x)) return false; n++; } }
    return n > 0;
  }

  function merge3(base, local, remote, opts) {
    opts = opts || {};
    if (equal(local, remote)) return clone(local);
    if (equal(base, local)) return clone(remote);
    if (equal(base, remote)) return clone(local);
    // les deux côtés ont changé
    if (Array.isArray(local) && Array.isArray(remote) && (base === MISSING || Array.isArray(base))) {
      return idArrays(base, local, remote) ? mergeById(base || [], local, remote, opts) : mergeSet(base || [], local, remote);
    }
    if (isObj(local) && isObj(remote) && (base === MISSING || isObj(base))) return mergeObj(base || {}, local, remote, opts);
    // valeurs simples (ou types différents) : le plus récent gagne
    if (local === MISSING) return clone(remote); // supprimé ici, modifié ailleurs : on garde
    if (remote === MISSING) return clone(local);
    return clone(opts.preferLocal === false ? remote : local);
  }

  function mergeObj(base, local, remote, opts) {
    let pref = opts.preferLocal;
    if (typeof local.maj === "string" && typeof remote.maj === "string" && local.maj !== remote.maj) pref = local.maj > remote.maj;
    const o2 = Object.assign({}, opts, { preferLocal: pref });
    const out = {}, keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    keys.forEach((k) => {
      const b = base[k], l = local[k], r = remote[k];
      const inL = Object.prototype.hasOwnProperty.call(local, k), inR = Object.prototype.hasOwnProperty.call(remote, k), inB = Object.prototype.hasOwnProperty.call(base, k);
      if (!inL && inB && equal(b, r)) return; // supprimé ici, pas touché ailleurs
      if (!inR && inB && equal(b, l)) return; // supprimé ailleurs, pas touché ici
      if (!inL && !inR) return;
      const v = merge3(inB ? b : MISSING, inL ? l : MISSING, inR ? r : MISSING, o2);
      if (v !== MISSING) out[k] = v;
    });
    return out;
  }

  function mergeById(base, local, remote, opts) {
    const idx = (arr) => { const m = new Map(); arr.forEach((x) => { if (hasId(x)) m.set(String(x.id), x); }); return m; };
    const B = idx(base), L = idx(local), R = idx(remote);
    const out = [], seen = new Set();
    const take = (id) => {
      if (seen.has(id)) return; seen.add(id);
      const b = B.get(id), l = L.get(id), r = R.get(id);
      if (l && r) { out.push(merge3(b, l, r, opts)); return; }
      if (l && !r) { if (b && equal(b, l)) return; out.push(clone(l)); return; } // supprimé ailleurs sans modif ici → supprimé
      if (r && !l) { if (b && equal(b, r)) return; out.push(clone(r)); return; } // supprimé ici sans modif ailleurs → supprimé
    };
    // ordre : celui du dépôt, puis les éléments ajoutés sur l'appareil, à leur place relative
    const localOnly = local.filter((x) => hasId(x) && !R.has(String(x.id))).map((x) => String(x.id));
    remote.forEach((x) => { if (hasId(x)) take(String(x.id)); });
    localOnly.forEach(take);
    return out;
  }

  function mergeSet(base, local, remote) {
    const key = (x) => JSON.stringify(sortKeys(x));
    const kb = new Set(base.map(key)), kl = new Set(local.map(key)), kr = new Set(remote.map(key));
    const out = [], seen = new Set();
    remote.forEach((x) => { const k = key(x); if (seen.has(k)) return; if (kb.has(k) && !kl.has(k)) return; seen.add(k); out.push(clone(x)); });
    local.forEach((x) => { const k = key(x); if (seen.has(k)) return; if (kb.has(k) && !kr.has(k)) return; seen.add(k); out.push(clone(x)); });
    return out;
  }

  // Après fusion du document equipe : deux tickets créés en même temps peuvent avoir le même numéro.
  // Le ticket qui n'existait que sur l'appareil prend le numéro suivant libre.
  function fixEquipe(merged, remote) {
    if (!merged || !Array.isArray(merged.tickets)) return merged;
    const remoteIds = new Set(((remote && remote.tickets) || []).map((t) => t && t.id));
    const used = new Map();
    merged.tickets.forEach((t) => { if (remoteIds.has(t.id)) used.set(Number(t.n), t.id); });
    let max = merged.tickets.reduce((m, t) => Math.max(m, Number(t.n) || 0), 0);
    merged.tickets.forEach((t) => {
      if (remoteIds.has(t.id)) return;
      const n = Number(t.n);
      if (!n || (used.has(n) && used.get(n) !== t.id)) t.n = ++max;
      used.set(Number(t.n), t.id);
    });
    return merged;
  }

  function mergeDoc(name, base, local, remote, opts) {
    let m = merge3(base, local, remote, opts);
    if (name === "equipe") m = fixEquipe(m, remote);
    return m;
  }

  const api = { merge3, mergeDoc, stableStringify, sortKeys, equal, clone };
  root.CockpitMerge = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this);
