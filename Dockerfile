
# Utilise une image officielle Node.js 22 basée sur Debian, avec un environnement relativement léger.
FROM node:22-bookworm-slim

# Définit l'environnement de l'application comme étant la production.
# Cela permet notamment à Node.js et aux bibliothèques d'adopter leur configuration de production.
ENV NODE_ENV=production

# Définit /app comme répertoire de travail à l'intérieur du conteneur.
# Les prochaines commandes s'exécuteront depuis ce répertoire, sauf indication contraire.
WORKDIR /app

# Copie les fichiers de configuration des dépendances dans le conteneur.
# package.json décrit les dépendances et package-lock.json verrouille leurs versions.
COPY package.json package-lock.json ./

# Installe uniquement les dépendances nécessaires en production.
# npm ci utilise package-lock.json pour effectuer une installation reproductible.
RUN npm ci --omit=dev

# Copie le fichier principal du serveur Express dans le conteneur.
COPY server.js ./

# Copie le dossier public contenant les fichiers frontend :
# HTML, CSS et JavaScript utilisés par la boutique.
COPY public ./public

# Crée le dossier destiné à la base de données SQLite.
# Attribue ensuite la propriété des fichiers de l'application à l'utilisateur node.
# Cela permet d'exécuter l'application sans utiliser l'utilisateur root.
RUN mkdir -p /app/data \
    && chown -R node:node /app

# Passe à l'utilisateur non privilégié node pour exécuter l'application.
# C'est une bonne pratique de sécurité dans un conteneur.
USER node

# Indique que l'application utilise le port 3000.
# Cette instruction documente le port, mais ne publie pas le port sur la machine hôte.
EXPOSE 3000

# Définit la commande exécutée au démarrage du conteneur.
# npm start lance le serveur Express défini dans package.json.
CMD ["npm", "start"]
