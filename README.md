# Atelier — boutique e-commerce

Application Full Stack en français : frontend HTML/CSS/JavaScript, API Express et base SQLite. Le projet reste volontairement léger, sans framework frontend ni prestataire de paiement.

## Fonctionnalités

- Catalogue avec recherche, catégories, tri et pagination côté API.
- Fiches détaillées, recommandations de la même catégorie et produits récemment consultés.
- Panier local persistant, synchronisé avec les stocks et les prix actuels de la base.
- Comptes avec mots de passe hachés, sessions persistées dans SQLite, cookie renouvelé à chaque requête pour 30 jours d'inactivité maximum et accès privé à l’espace client.
- Favoris enregistrés par utilisateur, tableau de bord, historique et détail de commande.
- Commande sans paiement en ligne : prix recalculés côté serveur, stock contrôlé et décrémenté dans une transaction SQLite ; clé d’idempotence pour prévenir les doubles soumissions.
- En-têtes de sécurité, page 404 personnalisée et mise en page responsive.

## Prérequis et démarrage

Node.js 22.5 ou plus récent (module SQLite intégré `node:sqlite`) et npm.

```powershell
npm install
npm run dev
```

Visitez [http://localhost:3000](http://localhost:3000). La base locale `data/shop.sqlite` et le catalogue de démonstration sont initialisés automatiquement. Le dossier `data/` est ignoré par Git.

Les produits historiques sont migrés avec un stock initial de démonstration de 20 pièces. Ajustez ce stock dans SQLite avant une utilisation réelle. Les migrations vérifient les colonnes manquantes puis ajoutent le stock, le statut de commande et la clé d’idempotence sans supprimer ni réinitialiser les utilisateurs, les produits ou les commandes existantes.

## Tests

```powershell
npm test
```

Les tests d’intégration utilisent une base temporaire séparée. Ils couvrent la validation des comptes, la recherche, les favoris, le stock, l’idempotence, l’isolation des commandes et la migration d’une base historique.

## Docker

```powershell
docker build -t atelier-ecommerce .
docker run --rm -p 3000:3000 `
  -e SESSION_SECRET="remplacer-par-un-secret-aleatoire-de-32-caracteres-minimum" `
  -v atelier-data:/app/data `
  atelier-ecommerce
```

Le volume conserve la base entre les redémarrages du conteneur. L’image s’exécute avec l’utilisateur non privilégié `node` et vérifie périodiquement l’API.

## Production et Azure

Définissez `NODE_ENV=production` et `SESSION_SECRET` dans l’environnement d’exécution. En production, le serveur refuse de démarrer si le secret n’est pas configuré ou contient moins de 32 caractères. Le cookie de session est automatiquement `Secure` sur une connexion HTTPS (y compris derrière le proxy Azure), mais reste compatible avec `http://localhost` pour le développement Docker ; définissez `COOKIE_SECURE=true` pour l’imposer ou `COOKIE_SECURE=false` si votre proxy TLS n’envoie pas `X-Forwarded-Proto: https`. Ne placez jamais les secrets dans le dépôt.

Le pipeline Azure (`azure-pipelines.yml`) suppose les connexions Azure/ACR déjà créées et une variable secrète `SESSION_SECRET` configurée dans Azure Pipelines. Il force le cookie de session sécurisé sur HTTPS. Le pipeline manuel `azure-pipelines-1.yml` exécute les tests et valide la construction du conteneur. Le déploiement configure le port 3000 et `SQLITE_PATH=/home/data/shop.sqlite`; le stockage persistant App Service doit être activé pour conserver la base SQLite. SQLite convient à une instance unique ; plusieurs réplicas nécessitent une base externe partagée.

## Limites connues

- Pas de paiement en ligne, de gestion d'adresses ou d'interface administrateur : les commandes sont confirmées sans paiement.
- Les produits, images et stocks sont des données de démonstration, modifiables directement dans SQLite.
- Les images et polices distantes nécessitent une connexion Internet.
- Le stockage SQLite est adapté au portfolio et au démarrage local, mais une boutique à trafic élevé ou multi-instance devrait migrer vers PostgreSQL.
