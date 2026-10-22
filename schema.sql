-- PromptHub : structure de la base de données (SQLite)
-- Ce fichier est lu automatiquement par app.py au démarrage.

-- 1. La table des prompts (créée seulement si elle n'existe pas déjà)
CREATE TABLE IF NOT EXISTS prompts (
    id        INTEGER PRIMARY KEY,
    titre     TEXT    NOT NULL UNIQUE,
    contenu   TEXT    NOT NULL,
    categorie TEXT    NOT NULL,
    likes     INTEGER NOT NULL DEFAULT 0,
    cree_le   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Quelques prompts de départ.
-- INSERT OR IGNORE : si le titre existe déjà, la ligne est simplement ignorée.
-- Dans un texte SQL, une apostrophe se double : l'IA devient l''IA.
INSERT OR IGNORE INTO prompts (titre, contenu, categorie) VALUES
    ('Résumeur express',
     'Résume le texte suivant en 5 points clés maximum, avec un langage simple. Texte : [colle ton texte ici]',
     'Productivité'),
    ('Plan de journée',
     'Voici mes tâches du jour : [liste]. Organise-les par priorité et propose un planning réaliste avec des pauses.',
     'Productivité'),
    ('Explique ce code',
     'Explique ligne par ligne ce code à un débutant, puis signale les erreurs possibles : [colle ton code]',
     'Code'),
    ('Chasseur de bugs',
     'Voici un message d''erreur et le code concerné. Explique la cause et propose une correction simple : [erreur] [code]',
     'Code'),
    ('Relecteur bienveillant',
     'Relis ce texte, corrige l''orthographe et la grammaire, puis propose trois améliorations de style : [texte]',
     'Écriture'),
    ('Idées d''articles',
     'Donne-moi 10 idées d''articles de blog originales sur le thème suivant : [thème].',
     'Écriture'),
    ('Prof particulier',
     'Explique-moi [sujet] comme si j''avais 12 ans, avec un exemple concret et une petite analogie.',
     'Apprentissage'),
    ('Quiz express',
     'Pose-moi un quiz de 5 questions sur [sujet], une question à la fois, et corrige mes réponses.',
     'Apprentissage');
