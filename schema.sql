-- PromptHub : structure de la base de données (SQLite)
-- Ce fichier est lu automatiquement par app.py au démarrage.

-- 1. La table des comptes (créée seulement si elle n'existe pas déjà)
-- mot_de_passe_hash peut rester vide (NULL) : c'est le cas d'un compte créé via
-- un réseau social, qui n'a pas de mot de passe PromptHub (voir fournisseur,
-- identifiant_externe, et connexion_sociale()/retour_connexion_sociale() dans app.py).
-- email peut aussi rester vide (compte social sans e-mail connu) ; l'index unique
-- qui l'accompagne est créé à part, dans migrer_colonnes_manquantes() (app.py),
-- pour fonctionner aussi sur une base déjà existante.
-- nom / prenom : remplissent l'inscription classique (voir pseudo_depuis_identite
-- dans app.py, qui fabrique nom_utilisateur à partir d'eux). Vides pour un compte
-- créé via un réseau social.
-- email_verifie : passe à 1 une fois le code reçu par e-mail confirmé (voir
-- generer_code_verification / verifier_email dans app.py).
-- est_admin : droits d'administration (modifier/supprimer n'importe quel prompt ou
-- commentaire). Attribué automatiquement à la connexion si l'e-mail du compte
-- figure dans admin_config.json (voir promouvoir_si_admin dans app.py) : pas besoin
-- de toucher la base à la main pour désigner un administrateur.
CREATE TABLE IF NOT EXISTS utilisateurs (
    id                  INTEGER PRIMARY KEY,
    nom_utilisateur     TEXT    NOT NULL UNIQUE,
    nom                 TEXT,
    prenom              TEXT,
    email               TEXT,
    email_verifie       INTEGER NOT NULL DEFAULT 0,
    mot_de_passe_hash   TEXT,
    fournisseur         TEXT,
    identifiant_externe TEXT,
    est_admin           INTEGER NOT NULL DEFAULT 0,
    cree_le             TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fournisseur, identifiant_externe)
);

-- 2. Les demandes de réinitialisation de mot de passe ("mot de passe oublié").
-- jeton_hash : le hash du jeton envoyé par e-mail (voir generer_jeton_reset dans app.py).
-- utilise : passe à 1 une fois le mot de passe changé, pour qu'un même lien ne
-- puisse pas servir deux fois.
CREATE TABLE IF NOT EXISTS reinitialisations_mot_de_passe (
    id             INTEGER PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    jeton_hash     TEXT    NOT NULL,
    expire_le      TEXT    NOT NULL,
    utilise        INTEGER NOT NULL DEFAULT 0,
    cree_le        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Les codes de vérification d'e-mail (inscription).
-- code_hash : le hash du code à 6 chiffres envoyé par e-mail (voir
-- generer_code_verification dans app.py) ; comme pour la réinitialisation de mot de
-- passe, seul le hash part en base, jamais le code en clair.
-- utilise : passe à 1 une fois l'e-mail confirmé, pour qu'un même code ne puisse pas
-- resservir.
CREATE TABLE IF NOT EXISTS verifications_email (
    id             INTEGER PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    code_hash      TEXT    NOT NULL,
    expire_le      TEXT    NOT NULL,
    utilise        INTEGER NOT NULL DEFAULT 0,
    cree_le        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. La table des prompts (créée seulement si elle n'existe pas déjà)
-- auteur_id peut rester vide (NULL) : c'est le cas des prompts de départ,
-- ci-dessous, qui n'appartiennent à aucun compte.
-- likes : ancien compteur anonyme, conservé pour ne pas casser une base existante,
-- mais plus utilisé depuis que les favoris sont liés à un compte (voir la table
-- favoris ci-dessous, et prompt_en_dict dans app.py qui calcule le vrai nombre de
-- favoris à la volée).
CREATE TABLE IF NOT EXISTS prompts (
    id         INTEGER PRIMARY KEY,
    titre      TEXT    NOT NULL UNIQUE,
    contenu    TEXT    NOT NULL,
    categorie  TEXT    NOT NULL,
    likes      INTEGER NOT NULL DEFAULT 0,
    auteur_id  INTEGER REFERENCES utilisateurs(id),
    cree_le    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Favoris : un prompt mis de côté par un compte (remplace l'ancien compteur de
-- ♥ anonyme, voir plus haut). Clé primaire composée : un même compte ne peut pas
-- favoriser deux fois le même prompt (un second clic retire le favori, voir
-- basculer_favori dans app.py).
CREATE TABLE IF NOT EXISTS favoris (
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    prompt_id      INTEGER NOT NULL REFERENCES prompts(id),
    cree_le        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (utilisateur_id, prompt_id)
);

-- 6. Notes : une note de 1 à 5 étoiles par compte et par prompt. Un compte qui note
-- à nouveau remplace simplement sa note précédente (voir noter_prompt dans app.py).
CREATE TABLE IF NOT EXISTS notes (
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    prompt_id      INTEGER NOT NULL REFERENCES prompts(id),
    etoiles        INTEGER NOT NULL CHECK (etoiles BETWEEN 1 AND 5),
    cree_le        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (utilisateur_id, prompt_id)
);

-- 7. Tags : mots-clés libres, tapés par l'auteur à la publication, en plus de la
-- catégorie unique du prompt. "nom" est toujours stocké en minuscules (voir
-- nettoyer_tags dans app.py) pour que "Code" et "code" comptent comme le même tag.
CREATE TABLE IF NOT EXISTS tags (
    id  INTEGER PRIMARY KEY,
    nom TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS prompts_tags (
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    tag_id    INTEGER NOT NULL REFERENCES tags(id),
    PRIMARY KEY (prompt_id, tag_id)
);

-- 8. Commentaires laissés sous un prompt.
CREATE TABLE IF NOT EXISTS commentaires (
    id             INTEGER PRIMARY KEY,
    prompt_id      INTEGER NOT NULL REFERENCES prompts(id),
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    contenu        TEXT    NOT NULL,
    cree_le        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Votes sur un commentaire (valeur = 1 pour 👍, -1 pour 👎), un seul par compte
-- et par commentaire : revoter avec la même valeur retire le vote, revoter avec
-- l'autre valeur le remplace (voir voter_commentaire dans app.py).
CREATE TABLE IF NOT EXISTS votes_commentaires (
    commentaire_id INTEGER NOT NULL REFERENCES commentaires(id),
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    valeur         INTEGER NOT NULL CHECK (valeur IN (-1, 1)),
    PRIMARY KEY (commentaire_id, utilisateur_id)
);

-- 10. Quelques prompts de départ, répartis sur les 5 catégories actuelles de la
-- bibliothèque (voir CATEGORIES dans app.py ; liste encore amenée à grandir).
-- INSERT OR IGNORE : si le titre existe déjà, la ligne est simplement ignorée.
-- Dans un texte SQL, une apostrophe se double : l'IA devient l''IA.
INSERT OR IGNORE INTO prompts (titre, contenu, categorie) VALUES
    ('Idées de posts réseaux sociaux',
     'Propose-moi 10 idées de posts pour [réseau social] sur le thème [thème], avec pour chacune une accroche et un format (photo, carrousel, vidéo courte...).',
     'Création de contenu'),
    ('Légende accrocheuse',
     'Écris 3 légendes différentes (une drôle, une inspirante, une informative) pour cette publication : [décris ta photo ou ta vidéo].',
     'Création de contenu'),
    ('Prompt retouche photo IA',
     'Décris une retouche à appliquer à cette photo avec un outil de génération d''image : [décris la photo et le résultat voulu] (éclairage, ambiance, arrière-plan).',
     'Éditeurs de photo (IA)'),
    ('Changer l''arrière-plan',
     'Propose un nouvel arrière-plan cohérent avec ce sujet pour un outil d''édition photo IA : [décris le sujet de la photo], dans une ambiance [ambiance souhaitée].',
     'Éditeurs de photo (IA)'),
    ('Résumeur express',
     'Résume le texte suivant en 5 points clés maximum, avec un langage simple. Texte : [colle ton texte ici]',
     'Analyse, correction, résumé et restructuration de texte'),
    ('Relecteur bienveillant',
     'Relis ce texte, corrige l''orthographe et la grammaire, puis propose trois améliorations de style : [texte]',
     'Analyse, correction, résumé et restructuration de texte'),
    ('Explique ce code',
     'Explique ligne par ligne ce code à un débutant, puis signale les erreurs possibles : [colle ton code]',
     'Code et programmation / Dev Web'),
    ('Chasseur de bugs',
     'Voici un message d''erreur et le code concerné. Explique la cause et propose une correction simple : [erreur] [code]',
     'Code et programmation / Dev Web'),
    ('Fiche produit vendeuse',
     'Rédige une fiche produit convaincante pour [produit], avec un titre accrocheur, 3 bénéfices clés et un appel à l''action.',
     'Tout pour le e-commerce et le marketing'),
    ('Campagne e-mail promo',
     'Écris un e-mail promotionnel pour [offre], avec un objet qui donne envie de l''ouvrir et un ton [ton souhaité].',
     'Tout pour le e-commerce et le marketing');
     