# Cockpit · application installable (PWA)

Application personnelle de suivi : tâches, projets, habitudes, humeur, rituels, planning, tickets. Elle fonctionne sur téléphone, tablette et ordinateur.

**Ce dépôt est public et ne contient que le code.** Les données vivent dans un **dépôt GitHub privé séparé** (par exemple `leon-data`), dans le dossier `data/`. Ce dépôt ne contient aucune donnée personnelle et aucun jeton.

- **Hors ligne** : l'app s'ouvre sans réseau (service worker) et garde une copie des données sur l'appareil (IndexedDB).
- **Synchronisation** : l'app lit et écrit les fichiers `data/<doc>.json` du dépôt privé avec l'API GitHub, à l'aide d'un jeton propre à chaque appareil.
- **Fusion** : si le dépôt a changé entre-temps (routine, autre appareil), l'app relit le fichier, fusionne élément par élément (identifiants), puis réécrit le résultat. Un ajout fait d'un côté n'est jamais perdu.
- **Changement de dépôt sûr** (v1.0.1) :
  - Il est **refusé** tant qu'une saisie n'est pas envoyée.
  - Sinon, la copie locale de l'ancien dépôt est **archivée sur l'appareil**, puis les données sont relues depuis le nouveau dépôt. Aucune donnée ancienne n'y est poussée.
  - « Oublier cet appareil » suit la même règle.

## Configurer un appareil

### 1. Créer un jeton GitHub (un par appareil)
1. Sur github.com, ouvre ta photo de profil > **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**.
2. **Token name** : le nom de l'appareil, par exemple « Cockpit PC ». **Expiration** : 90 jours (à renouveler).
3. **Repository access** : **Only select repositories**, puis **seulement** ton dépôt de données privé.
4. **Repository permissions** :
   - **Contents** : **Read and write** ;
   - **Metadata** : Read-only (automatique) ;
   - rien d'autre.
5. **Generate token**, puis copie-le pour le coller **uniquement dans l'app**. Ne le mets jamais dans une note, un message ou un fichier.

### 2. Régler l'app
**Réglages** > section « Dépôt de données privé » :
- **Propriétaire** : ton compte GitHub ;
- **Dépôt** : ton dépôt de données ;
- **Branche** : `main` ;
- **Dossier** : `data`.

Colle ensuite le jeton, puis **Enregistrer**. L'état doit passer à « À jour ».

Le bouton **Tester le jeton** vérifie l'accès sans rien écrire.

### 3. Installer
- **iPhone, iPad** : ouvre l'adresse de l'app dans Safari > **Partager** > **Sur l'écran d'accueil**. Ouvre-la ensuite depuis l'icône.
- **Ordinateur** : ouvre l'adresse dans Edge ou Chrome > icône « Installer l'application ».

## Limites
- Pas d'assistant intégré : « Demander à Léon » crée un ticket.
- Photos non affichées (prévu).
- Pas de rendez-vous d'agenda dans les rituels.
- La synchronisation n'a lieu que quand l'app est ouverte (à l'ouverture, au retour du réseau, puis chaque minute).

## Développement
- **Fichiers** : `index.html`, `styles.css`, `app.js` (écrans), `store.js` (stockage local et synchronisation GitHub), `merge.js` (fusion), `sw.js` (hors ligne), `manifest.webmanifest`, `fonts/`, `icons/`.
- **Nouvelle version** : changer `VERSION` dans `sw.js` et `APP_VERSION` dans `app.js`.
- **Tests** (Node et Playwright), sur des **données fictives** (`tests/fixtures/`) :
  - `node tests/merge.test.js` : fusion ;
  - `node tests/run-tests.js <dossier de captures>` : navigateur, avec un faux GitHub multi-dépôts. Ils couvrent :
    - le téléphone et l'ordinateur ;
    - la lecture et l'écriture ;
    - le mode hors ligne ;
    - les conflits ;
    - le changement de dépôt.
- **Développement sur branche**, publication (fusion dans `main`, GitHub Pages) seulement après validation.
- Le jeton ne quitte jamais l'appareil. Il est stocké dans IndexedDB et envoyé seulement à l'API GitHub.
