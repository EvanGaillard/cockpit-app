# Cockpit · l'app installable (v1, en test)

Le Cockpit en application pour iPhone, iPad et PC Windows. Mêmes écrans que le Cockpit en ligne (Aujourd'hui, tâches avec la méthode « quand », projets par domaine et sections, Logbook, tags, « en cours », habitudes, humeur, rituels du matin et du soir avec le brief, objectif du jour, emploi du temps de 10 semaines avec comptes rendus, Équipe et tickets, boîte à idées, achats et références), **sans IA intégrée** : les boutons du copilote sont remplacés par « Demander à Léon », qui prépare un ticket.

- **Hors ligne** : l'app s'ouvre sans réseau (service worker) et garde tes données sur l'appareil (IndexedDB). Tes changements partent dès que le réseau revient.
- **Synchronisation** : les données sont les fichiers `Systeme/Cockpit/data/<doc>.json` du dépôt privé du coffre, au même format que la base du Cockpit en ligne. L'app lit et écrit avec l'API GitHub, avec un jeton propre à chaque appareil. Chaque envoi est un commit « app : tasks », « app : habits »…
- **Fusion** : si le dépôt a changé entre-temps (Léon, un autre appareil), l'app relit, fusionne élément par élément (`id`) et réécrit. Rien n'est perdu : une tâche ou un ticket ajouté ailleurs est toujours gardé. Si le même champ a changé des deux côtés, le plus récent gagne.

## Ce que fait Evan (une fois)

### 1. Créer le jeton GitHub (un par appareil)

1. Sur github.com, connecté : photo de profil en haut à droite > **Settings**.
2. Tout en bas à gauche : **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**.
3. **Token name** : « Cockpit iPhone » (puis un autre pour l'iPad, le PC). **Expiration** : 1 an (note la date : il faudra le refaire).
4. **Resource owner** : EvanGaillard. **Repository access** : **Only select repositories** > `Claude-2nd-Brain`.
5. **Permissions** > **Repository permissions** > **Contents** : **Read and write**. (Metadata passe tout seul en lecture.) Rien d'autre.
6. **Generate token**, puis copie-le tout de suite (il commence par `github_pat_`, GitHub ne le remontre plus).

Ne le colle nulle part ailleurs que dans l'app (pas dans une note, pas dans un message).

### 2. Héberger l'app

Le dépôt du coffre est privé : GitHub Pages n'y est pas possible sans offre payante.

| Option | Pour | Contre |
|---|---|---|
| **(a) Petit dépôt public `cockpit-app` + GitHub Pages** | Gratuit, adresse fixe en https, versions suivies ; Hugo peut publier les mises à jour par Git. | Le code est public (aucune donnée ni secret dedans, mais on y voit le nom du dépôt du coffre et le lien du bureau de Léon). |
| **(b) Cloudflare Pages ou Netlify, glisser-déposer du dossier** | Gratuit, code non public, en ligne en 2 minutes. | Chaque mise à jour = refaire le glisser-déposer à la main ; un compte de plus. (Les relier au dépôt privé donnerait à ce service l'accès à tout le coffre : à éviter.) |

**Recommandation : (a)**. Le code ne contient rien de privé, et les mises à jour se font sans toi.

Étapes pour (a) :

1. github.com > **+** en haut à droite > **New repository**. Nom : `cockpit-app`. **Public**. Coche « Add a README file ». **Create repository**.
2. Dans le dépôt : **Add file** > **Upload files**. Glisse **le contenu** du dossier `Systeme/Cockpit/app/` (les fichiers `index.html`, `app.js`… et les dossiers `icons` et `fonts` ; `tests` n'est pas utile). **Commit changes**.
   Ou demande à Léon : « ajoute le dépôt cockpit-app au bureau et publie l'app » (Hugo pousse le dossier).
3. **Settings** > **Pages** > **Source : Deploy from a branch** > Branch **main**, dossier **/ (root)** > **Save**.
4. Une à deux minutes plus tard, l'adresse est : **https://evangaillard.github.io/cockpit-app/**

### 3. Installer

**iPhone et iPad** (Safari obligatoire) :

1. Ouvre l'adresse dans **Safari**.
2. Bouton **Partager** (carré avec une flèche) > **Sur l'écran d'accueil** > **Ajouter**.
3. Ouvre l'app **depuis l'icône** (pas depuis Safari : l'app installée a son propre stockage).
4. Onglet **Réglages** (pastille de synchro en haut d'Aujourd'hui) > colle le jeton de cet appareil > **Enregistrer**. L'état passe à « À jour ».

**PC Windows** (Edge) :

1. Ouvre l'adresse dans **Edge**.
2. Icône **Application disponible** à droite de la barre d'adresse (ou menu **…** > **Applications** > **Installer ce site en tant qu'application**) > **Installer**.
3. Dans l'app : **Réglages** > colle le jeton du PC > **Enregistrer**.

Le bouton **Tester le jeton** vérifie l'accès sans rien écrire. **Oublier cet appareil** efface le jeton et la copie locale.

## Limites de la v1

- **Pas de copilote** : « Demander à Léon » prépare une demande dans l'onglet Équipe (ticket `nouveau`, `source: "app"`), traitée par les routines.
- **Pas de photos** : l'app ne peut pas lire les photos stockées dans le Cockpit en ligne ; elle indique seulement « N photos · visible dans le Cockpit en ligne ». Les captures se font en texte. Piste v2 : photos dans Drive ou dans le dépôt.
- **Pas de Google Agenda** : les rituels montrent le programme de 10 semaines et les échéances, pas les rendez-vous. L'objectif du jour se déduit du programme et des tâches.
- **Synchro quand l'app est ouverte** : à l'ouverture, au retour du réseau, puis chaque minute. iOS ne laisse pas une web app synchroniser en arrière-plan.
- **Pendant la période en parallèle**, le Cockpit en ligne et l'app ne partagent pas leurs données : l'app suit les fichiers du dépôt, le Cockpit en ligne sa propre base. Utilise l'un ou l'autre, pas les deux, jusqu'à la bascule (et le brief de Léon n'arrive dans l'app que si ses routines écrivent aussi `data/brief.json`).
- **« Le plus récent gagne »** se juge par document (heure du dernier changement sur l'appareil contre heure du dernier commit), sauf pour les tickets qui ont leur propre `maj`.

## Pour Hugo

Fichiers : `index.html` (écrans), `styles.css` (direction artistique du Cockpit, polices embarquées dans `fonts/`, licence SIL Open Font License), `app.js` (interface, portée de `cockpit.html`), `store.js` (IndexedDB + API GitHub Contents), `merge.js` (fusion à trois voies), `sw.js` (cache hors ligne), `manifest.webmanifest`, `icons/` (générées par `icons/make-icons.py` depuis `Systeme/icone-cockpit.png`).

- **Publier une nouvelle version** : changer `VERSION` dans `sw.js` et `APP_VERSION` dans `app.js`. L'app affiche « Nouvelle version · Recharger ».
- **Tests** (depuis la racine du coffre, Node et Playwright) :
  - `node Systeme/Cockpit/app/tests/merge.test.js` : la fusion, sans navigateur.
  - `node Systeme/Cockpit/app/tests/run-tests.js <dossier des captures>` : Chromium avec un faux GitHub qui part d'une copie de `data/` (les vrais fichiers ne sont jamais modifiés). Téléphone 390 px et ordinateur 1280 px, pas d'erreur JavaScript, pas de défilement horizontal, cocher, ajouter, hors ligne puis resynchro, conflit 409 résolu sans perte, ticket, ouverture hors ligne par le service worker.
- Les fichiers de données sont écrits clés triées, indentation 1 (même format que l'instantané), pour des diffs Git lisibles.
- Le jeton ne quitte jamais l'appareil : il est dans IndexedDB (`cockpit-app` > `kv` > `token`), envoyé seulement à `api.github.com`.
