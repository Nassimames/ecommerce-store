# Atelier — boutique en ligne

Petite boutique e-commerce en français, réalisée en HTML, CSS, JavaScript, Express et SQLite...

## Prérequis

- Node.js 22.5 ou plus récent (`node:sqlite` est fourni par Node).
- npm.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000). La base `data/shop.sqlite` et les produits de démonstration sont créés au premier démarrage.

## Fonctionnalités

- Catalogue de produits et fiches détaillées.
- Panier conservé dans le navigateur.
- Création de compte, connexion et déconnexion.
- Commande enregistrée avec ses articles et son total, calculé côté serveur.
- Historique des commandes du compte connecté.

Les mots de passe sont hachés avant stockage. La base SQLite contient les produits, les utilisateurs et les commandes.

## Configuration de production

Définissez `NODE_ENV=production` et `SESSION_SECRET` dans l’environnement du serveur. Le secret doit contenir au moins 32 caractères. Par exemple, dans PowerShell :

```powershell
$env:NODE_ENV = "production"
$env:SESSION_SECRET = "remplacer-par-une-valeur-aleatoire-de-32-caracteres-minimum"
npm start
```

La boutique est un point de départ : les produits de démonstration, le nom Atelier et les visuels peuvent être adaptés à votre activité.
